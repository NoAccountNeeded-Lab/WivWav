import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@wivwav/db'
import { PrismaClient } from '@wivwav/db'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { deleteSmokeFixtureRows } from './fixture-cleanup.js'
import { fixtureListingId, fixtureSourceId } from './fixture-db.js'

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) throw new Error('DATABASE_URL is required for e2e cleanup integration tests')

const pool = new Pool({ connectionString: databaseUrl, max: 2 })
const db = new PrismaClient({ adapter: new PrismaPg(pool) })

const otherSourceId = 'unrelated-source'
const otherListingId = 'unrelated-listing'

function listing(
  id: string,
  sourceId: string,
  duplicateOf?: string,
): Prisma.ListingUncheckedCreateInput {
  return {
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    condition: 'used',
    sellerType: 'dealer',
    listedAt: new Date('2026-01-15T12:00:00.000Z'),
    priceCents: 1000,
    id,
    sourceId,
    sourceUrl: `https://example.com/${id}`,
    sourceRecordKey: id,
    ...(duplicateOf ? { canonicalId: duplicateOf, isDuplicate: true } : {}),
  }
}

async function seed(): Promise<void> {
  for (const id of [fixtureSourceId, otherSourceId]) {
    await db.source.create({ data: { id, name: id, baseUrl: 'https://example.com' } })
  }
  await db.listing.create({ data: listing(fixtureListingId, fixtureSourceId) })
  // Unrelated listing on another source, deduplicated onto the fixture.
  await db.listing.create({
    data: listing(otherListingId, otherSourceId, fixtureListingId),
  })
  await db.listingPriceHistory.create({
    data: { listingId: fixtureListingId, priceCents: 100 },
  })
  await db.listingPriceHistory.create({
    data: { listingId: otherListingId, priceCents: 200 },
  })
  await db.scraperRun.create({ data: { sourceId: fixtureSourceId } })
  await db.scraperRun.create({ data: { sourceId: otherSourceId } })
}

async function reset(): Promise<void> {
  const listingIds = [fixtureListingId, otherListingId]
  const sourceIds = [fixtureSourceId, otherSourceId]
  await db.listingPriceHistory.deleteMany({ where: { listingId: { in: listingIds } } })
  await db.scraperRun.deleteMany({ where: { sourceId: { in: sourceIds } } })
  await db.listing.deleteMany({ where: { id: otherListingId } })
  await db.listing.deleteMany({ where: { id: fixtureListingId } })
  await db.source.deleteMany({ where: { id: { in: sourceIds } } })
}

describe('deleteSmokeFixtureRows', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  afterAll(async () => {
    await reset()
    await db.$disconnect()
    await pool.end()
  })

  it('removes only the fixture source, listing and their children', async () => {
    await deleteSmokeFixtureRows(db)

    expect(await db.source.findUnique({ where: { id: fixtureSourceId } })).toBeNull()
    expect(await db.listing.findUnique({ where: { id: fixtureListingId } })).toBeNull()
    expect(await db.listingPriceHistory.count({ where: { listingId: fixtureListingId } })).toBe(0)
    expect(await db.scraperRun.count({ where: { sourceId: fixtureSourceId } })).toBe(0)
  })

  it('preserves unrelated sources, listings and children', async () => {
    await deleteSmokeFixtureRows(db)

    expect(await db.source.findUnique({ where: { id: otherSourceId } })).not.toBeNull()
    const other = await db.listing.findUnique({ where: { id: otherListingId } })
    expect(other).not.toBeNull()
    expect(other?.canonicalId).toBeNull()
    expect(await db.listingPriceHistory.count({ where: { listingId: otherListingId } })).toBe(1)
    expect(await db.scraperRun.count({ where: { sourceId: otherSourceId } })).toBe(1)
  })

  it('covers every blocking foreign key into listings, sources and listing images', async () => {
    // Guards against a new child table silently breaking cleanup with an FK error.
    const rows = await pool.query<{ child: string }>(
      `SELECT DISTINCT conrelid::regclass::text AS child
         FROM pg_constraint
        WHERE contype = 'f'
          AND confdeltype IN ('a', 'r')
          AND confrelid::regclass::text IN ('listings', 'sources', 'listing_image')
          AND conrelid::regclass::text <> 'listings'
        ORDER BY 1`,
    )
    expect(rows.rows.map((row) => row.child)).toEqual([
      'listing_conversion_history',
      'listing_field_claim',
      'listing_image',
      'listing_image_semantic_analysis',
      'listing_mileage_history',
      'listing_observation',
      'listing_price_history',
      'listing_reports',
      'vehicle_identity_decision',
    ])
  })

  it('is idempotent', async () => {
    await deleteSmokeFixtureRows(db)
    await expect(deleteSmokeFixtureRows(db)).resolves.toBeUndefined()
    expect(await db.source.count({ where: { id: otherSourceId } })).toBe(1)
  })
})
