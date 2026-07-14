import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { runBackfill } from './field-claims-backfill.js'

// Exercises the #499 field-claims backfill against a real, migrated Postgres
// — the transactional recordClaim/applyFieldResolution calls it drives per
// listing are already unit-covered via claims-repository.integration.test.ts;
// this file covers the backfill's own selection/skip logic (already-claimed
// vs. no-evidence vs. seed-eligible) and its report/apply mode split.
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_field_claim", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: { name: `Backfill Test Source ${sourceCounter}`, baseUrl: `https://source-${sourceCounter}.example.com` },
  })
}

let listingCounter = 0
async function createListing(sourceId: string, overrides: Record<string, unknown> = {}) {
  listingCounter += 1
  return db.listing.create({
    data: {
      sourceId,
      sourceUrl: `https://source.example.com/listing-${listingCounter}`,
      sourceRecordKey: `key-${listingCounter}`,
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      condition: 'used',
      sellerType: 'dealer',
      status: 'active',
      listedAt: new Date('2026-01-01'),
      ...overrides,
    },
  })
}

describe('field-claims-backfill (integration)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
    await disconnectDb()
  })

  it('report mode seeds nothing and predicts source_reported for a pre-#499 listing with a real value', async () => {
    const source = await createSource()
    const listing = await createListing(source.id, { conversionType: 'rear_entry', rampType: 'unknown' })

    const report = await runBackfill({ apply: false })

    expect(report.totalEvaluated).toBe(1)
    expect(report.seeded).toBe(1) // conversionType only — rampType has no evidence
    expect(report.byField.conversionType.source_reported).toBe(1)
    expect(report.byField.rampType.unknown).toBe(1)

    const claims = await db.listingFieldClaim.findMany({ where: { listingId: listing.id } })
    expect(claims).toHaveLength(0)

    const row = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(row.conversionTypeResolution).toBe('unknown') // unchanged — report mode never writes
  })

  it('apply mode seeds a claim and writes source_reported resolution without changing the normalized value', async () => {
    const source = await createSource()
    const listing = await createListing(source.id, { conversionType: 'side_entry', rampType: 'in_floor' })

    const report = await runBackfill({ apply: true })

    expect(report.seeded).toBe(2)
    expect(report.byField.conversionType.source_reported).toBe(1)
    expect(report.byField.rampType.source_reported).toBe(1)

    const row = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(row.conversionType).toBe('side_entry') // never rewritten — backfill only seeds evidence
    expect(row.conversionTypeResolution).toBe('source_reported')
    expect(row.rampType).toBe('in_floor')
    expect(row.rampTypeResolution).toBe('source_reported')

    const claims = await db.listingFieldClaim.findMany({ where: { listingId: listing.id } })
    expect(claims).toHaveLength(2)
    expect(claims.every((c) => c.extractorVersion === 'backfill-v1')).toBe(true)
  })

  it('leaves a listing already touched by the live pipeline untouched', async () => {
    const source = await createSource()
    const listing = await createListing(source.id, {
      conversionType: 'rear_entry',
      conversionTypeResolution: 'verified',
    })
    await db.listingFieldClaim.create({
      data: {
        listingId: listing.id,
        field: 'conversionType',
        claimedValue: 'rear_entry',
        evidenceKind: 'structured_source',
        sourceRef: listing.sourceUrl,
        observedAt: new Date(),
        extractorVersion: 'source-card-v1',
      },
    })

    const report = await runBackfill({ apply: true })

    expect(report.alreadyClaimed).toBe(1)
    expect(report.seeded).toBe(0)

    const claims = await db.listingFieldClaim.findMany({ where: { listingId: listing.id, field: 'conversionType' } })
    expect(claims).toHaveLength(1) // no duplicate/backfill claim added
    expect(claims[0]!.extractorVersion).toBe('source-card-v1')
  })

  it('is idempotent — a second run seeds nothing further', async () => {
    const source = await createSource()
    await createListing(source.id, { conversionType: 'rear_entry' })

    await runBackfill({ apply: true })
    const secondReport = await runBackfill({ apply: true })

    expect(secondReport.seeded).toBe(0)
    expect(secondReport.alreadyClaimed).toBe(1)
  })

  it('never produces a conflicting resolution on its own', async () => {
    const source = await createSource()
    await createListing(source.id, { conversionType: 'rear_entry' })
    await createListing(source.id, { conversionType: 'side_entry' })
    await createListing(source.id, { rampType: 'fold_out' })

    const report = await runBackfill({ apply: true })

    expect(report.byField.conversionType.conflicting).toBe(0)
    expect(report.byField.rampType.conflicting).toBe(0)
  })

  it('scopes the audit to a single source when sourceId is provided', async () => {
    const sourceA = await createSource()
    const sourceB = await createSource()
    await createListing(sourceA.id, { conversionType: 'rear_entry' })
    await createListing(sourceB.id, { conversionType: 'side_entry' })

    const report = await runBackfill({ apply: false, sourceId: sourceA.id })

    expect(report.totalEvaluated).toBe(1)
  })
})
