import type { PrismaClient, Source, Listing, Prisma } from '@wivwav/db'
import { getDb, disconnectDb } from '@wivwav/db'

/**
 * Real PrismaClient for integration tests, connected via DATABASE_URL.
 * Integration specs assume an already-migrated database — CI runs
 * `pnpm db:migrate` before `pnpm test:integration`; do the same locally.
 * Pair with `closeIntegrationDb` in an `afterAll` so the pg pool doesn't
 * keep the process alive after the suite finishes.
 */
export function integrationDb(): PrismaClient {
  return getDb()
}

/** Closes the pg pool opened by `integrationDb`. Call once per test file's `afterAll`. */
export function closeIntegrationDb(): Promise<void> {
  return disconnectDb()
}

/**
 * Truncates every table touched by the current integration suites and
 * resets identity sequences, cascading to dependents. Call in `beforeEach`
 * so each test starts from a known-empty state without needing a real
 * per-test transaction (Prisma's node-postgres adapter pool makes ad-hoc
 * transaction wrapping across test bodies impractical).
 *
 * NOTE: this list must include every table any *.integration.test.ts under
 * apps/api writes to — a table left off here won't be reset between tests,
 * causing state to leak across test cases instead of erroring loudly.
 */
export async function resetIntegrationDb(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "listing_price_history",
      "listing_reports",
      "listing_field_claim",
      "job_run",
      "scraper_runs",
      "listings",
      "sources",
      "nmea_dealers"
    RESTART IDENTITY CASCADE
  `)
}

let sourceCounter = 0

/** Creates a minimal valid Source row, overridable per test. */
export function createSource(
  db: PrismaClient,
  overrides: Partial<Prisma.SourceCreateInput> = {},
): Promise<Source> {
  sourceCounter += 1
  return db.source.create({
    data: {
      name: `Test Source ${sourceCounter}`,
      baseUrl: `https://source-${sourceCounter}.example.com`,
      ...overrides,
    },
  })
}

let listingCounter = 0

/** Creates a minimal valid Listing row, overridable per test. */
export function createListing(
  db: PrismaClient,
  sourceId: string,
  overrides: Partial<Prisma.ListingUncheckedCreateInput> = {},
): Promise<Listing> {
  listingCounter += 1
  return db.listing.create({
    data: {
      sourceId,
      sourceUrl: `https://source.example.com/listing-${listingCounter}`,
      sourceRecordKey: `listing-${listingCounter}`,
      make: 'Toyota',
      model: 'Sienna',
      year: 2020,
      condition: 'used',
      sellerType: 'dealer',
      status: 'active',
      publicationStatus: 'eligible',
      listedAt: new Date(),
      images: [],
      ...overrides,
    },
  })
}
