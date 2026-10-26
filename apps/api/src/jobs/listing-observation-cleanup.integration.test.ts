import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { runListingObservationCleanupJob } from './listing-observation-cleanup.js'

const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE "listing_observation", "listings", "sources" RESTART IDENTITY CASCADE')
}

describe('listing-observation-cleanup (integration)', () => {
  beforeEach(async () => resetDb())

  afterAll(async () => {
    await resetDb()
    await disconnectDb()
  })

  it('deletes backdated observations while retaining observations inside the 90-day window', async () => {
    const source = await db.source.create({
      data: { name: `Observation retention ${Date.now()}`, baseUrl: 'https://observation-retention.example.com' },
    })
    const listing = await db.listing.create({
      data: {
        sourceId: source.id,
        sourceUrl: 'https://observation-retention.example.com/listing',
        sourceRecordKey: `observation-retention-${Date.now()}`,
        make: 'Toyota',
        model: 'Sienna',
        year: 2022,
        condition: 'used',
        sellerType: 'dealer',
        listedAt: new Date('2026-01-01'),
      },
    })
    const now = Date.now()
    await db.listingObservation.createMany({
      data: [
        {
          listingId: listing.id,
          stage: 'detail',
          reference: 'retention-old',
          extractionVersion: 'test',
          changedFields: [],
          before: {},
          after: {},
          observedAt: new Date(now - 91 * 24 * 60 * 60 * 1000),
        },
        {
          listingId: listing.id,
          stage: 'list_card',
          reference: 'retention-recent',
          extractionVersion: 'test',
          changedFields: [],
          before: {},
          after: {},
          observedAt: new Date(now - 89 * 24 * 60 * 60 * 1000),
        },
      ],
    })

    await runListingObservationCleanupJob()

    const remaining = await db.listingObservation.findMany({
      where: { listingId: listing.id },
      select: { reference: true },
    })
    expect(remaining).toEqual([{ reference: 'retention-recent' }])
  })
})
