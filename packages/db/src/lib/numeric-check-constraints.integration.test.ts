import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectDb, getDb } from '../index.js'
import type { PrismaClient } from '../generated/prisma/index.js'

// Proves the migration-only CHECK constraints from #1116 reject impossible
// values even when application validation is bypassed (raw SQL writes).
// Requires a migrated database: `pnpm db:migrate` before running.
const db: PrismaClient = getDb()

async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "listing_price_history", "listings", "sources" RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0
async function createSource() {
  sourceCounter += 1
  return db.source.create({
    data: {
      name: `Check Constraint Test Source ${sourceCounter}`,
      baseUrl: `https://check-constraint-${sourceCounter}.example.com`,
    },
  })
}

let listingCounter = 0
async function createListing(sourceId: string) {
  listingCounter += 1
  return db.listing.create({
    data: {
      sourceId,
      sourceUrl: `https://check-constraint.example.com/listing-${listingCounter}`,
      sourceRecordKey: `check-key-${listingCounter}`,
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      condition: 'used',
      sellerType: 'dealer',
      listedAt: new Date('2026-01-01'),
    },
  })
}

describe('numeric/range CHECK constraints (integration)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await resetDb()
    await disconnectDb()
  })

  it('should reject a negative priceCents via raw SQL', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "listing_price_history" ("id", "listingId", "priceCents") VALUES ('check-neg-price', $1, -1)`,
        listing.id,
      ),
    ).rejects.toThrow(/check constraint/i)
  })

  it('should reject an out-of-range lat via raw SQL', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await expect(
      db.$executeRawUnsafe(`UPDATE "listings" SET "lat" = 500 WHERE "listings"."id" = $1`, listing.id),
    ).rejects.toThrow(/check constraint/i)
  })

  it('should accept boundary-valid values via raw SQL', async () => {
    const source = await createSource()
    const listing = await createListing(source.id)
    await db.$executeRawUnsafe(
      `INSERT INTO "listing_price_history" ("id", "listingId", "priceCents") VALUES ('check-zero-price', $1, 0)`,
      listing.id,
    )
    await db.$executeRawUnsafe(`UPDATE "listings" SET "lat" = 90, "lng" = -180 WHERE "listings"."id" = $1`, listing.id)
    const updated = await db.listing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(updated.lat).toBe(90)
    expect(updated.lng).toBe(-180)
  })
})
