import { describe, it, expect, vi } from 'vitest'
import { PrismaListingRepository, PrismaSourceRepository } from './prisma-repositories.js'
import type { ListingUpsertData } from '../engine/repositories.js'

// Persistence-layer behavior only (Prisma transaction/retry wiring). The
// upsert diffing, history-write, and idempotency business logic lives in
// apps/scraper/src/application/listing-ingest.ts and is covered by
// listing-ingest.test.ts — this file must not grow ingest business-logic
// assertions (refs #671).

function makeListing(overrides: Partial<ListingUpsertData> = {}): ListingUpsertData {
  return {
    sourceId: 'src-1',
    sourceUrl: 'http://example.com/1',
    buyerUrl: 'http://example.com/1',
    externalId: 'ext-1',
    stockNumber: null,
    sourceRecordKey: 'ext-1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: null,
    vin: null,
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 3000000,
    mileage: null,
    color: null,
    fuelType: null,
    transmission: null,
    wav: {
      conversionType: 'unknown',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown' as const,
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city: null, state: null, lat: null, lng: null },
    dealer: { name: null, phone: null, website: null },
    images: [],
    description: null,
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeDb(
  existingListing: Partial<{
    id: string
    sourceUrl: string
    buyerUrl: string | null
    externalId: string | null
    stockNumber: string | null
    make: string
    model: string
    year: number
    trim: string | null
    vin: string | null
    condition: 'new' | 'used' | 'certified_pre_owned'
    sellerType?: 'dealer' | 'private'
    priceCents: number | null
    mileage: number | null
    color: string | null
    conversionType: 'rear_entry' | 'side_entry' | 'unknown'
    conversionManufacturer: string | null
    floorLoweringInches: number | null
    rampType: 'in_floor' | 'fold_out' | 'fold_in' | 'none' | 'unknown'
    conversionStatus: 'proposed' | 'complete' | 'unknown'
    wavFeatures: string[]
    wheelchairCapacity: number | null
    zip: string | null
    city: string | null
    state: string | null
    dealerName: string | null
    cardImages: string[]
    qualityIssueCodes: string[]
    status: string
  }> & { id: string; priceCents: number | null } | null = null,
) {
  const fixture = makeListing()
  const existing = existingListing
    ? {
        sourceUrl: fixture.sourceUrl,
        buyerUrl: fixture.buyerUrl,
        externalId: fixture.externalId,
        stockNumber: fixture.stockNumber,
        make: fixture.make,
        model: fixture.model,
        year: fixture.year,
        trim: fixture.trim,
        vin: fixture.vin,
        condition: fixture.condition,
        sellerType: fixture.sellerType,
        status: 'active',
        mileage: fixture.mileage,
        color: fixture.color,
        conversionType: fixture.wav.conversionType,
        conversionManufacturer: fixture.wav.conversionManufacturer,
        floorLoweringInches: fixture.wav.floorLoweringInches,
        rampType: fixture.wav.rampType,
        conversionStatus: fixture.wav.conversionStatus,
        wavFeatures: [],
        wheelchairCapacity: fixture.wav.wheelchairCapacity,
        zip: fixture.location.zip,
        city: fixture.location.city,
        state: fixture.location.state,
        dealerName: fixture.dealer.name,
        cardImages: fixture.images,
        qualityIssueCodes: [],
        ...existingListing,
      }
    : null

  const db = {
    listing: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({ id: 'list-created' }),
      update: vi.fn().mockResolvedValue({}),
    },
    listingPriceHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    listingMileageHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    listingConversionHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    listingObservation: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db))
  return db
}

describe('PrismaListingRepository', () => {
  describe('upsert P2028 transient retry', () => {
    // These tests use real timers; withTransientRetry backs off 100ms then 200ms on retry.
    // Total delay per test is at most 300ms — acceptable for a unit suite.

    it('retries and succeeds when the first upsert attempt throws P2028', async () => {
      const p2028 = Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' })
      const db = makeDb(null)
      // First call throws P2028, second call succeeds
      db.listing.create
        .mockRejectedValueOnce(p2028)
        .mockResolvedValueOnce({})
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).resolves.toMatchObject({ outcome: 'created' })
      expect(db.listing.create).toHaveBeenCalledTimes(2)
    }, 1000)

    it('propagates P2028 after exhausting all retry attempts', async () => {
      const p2028 = Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' })
      const db = makeDb(null)
      db.listing.create.mockRejectedValue(p2028)
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).rejects.toMatchObject({ code: 'P2028' })
      expect(db.listing.create).toHaveBeenCalledTimes(3)
    }, 1000)

    it('does not retry on non-transient errors', async () => {
      const uniqueViolation = Object.assign(new Error('Invalid query'), { code: 'P2010' })
      const db = makeDb(null)
      db.listing.create.mockRejectedValue(uniqueViolation)
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).rejects.toMatchObject({ code: 'P2010' })
      expect(db.listing.create).toHaveBeenCalledTimes(1)
    })

    it('retries a serializable transaction conflict without duplicating the committed observation', async () => {
      const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' })
      const db = makeDb(null)
      db.$transaction.mockRejectedValueOnce(conflict)
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing())).resolves.toMatchObject({ outcome: 'created' })
      // This checks retry non-duplication (the transaction boundary), not
      // ingest diffing logic — that stays covered in listing-ingest.test.ts.
      expect(db.listingObservation.create).toHaveBeenCalledTimes(1)
    })
  })
})

// A Source row can be deleted (or a stale scheduler/adapter can outlive a DB
// reseed) while a run is in flight — see #807. These tests guard against that
// crashing the run or masking whatever error actually caused it to fail.
describe('PrismaSourceRepository record-not-found tolerance (#807)', () => {
  function makeSourceDb() {
    return {
      source: {
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
  }

  it('swallows P2025 on markError instead of throwing', async () => {
    const p2025 = Object.assign(new Error('An operation failed because it depends on one or more records that were required but not found.'), { code: 'P2025' })
    const db = makeSourceDb()
    db.source.update.mockRejectedValueOnce(p2025)
    const warn = vi.fn()
    const repo = new PrismaSourceRepository(db as never, { warn } as never)

    await expect(repo.markError('gone-id', 'boom')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith({ sourceId: 'gone-id' }, expect.any(String))
  })

  it('swallows P2025 on markActive instead of throwing', async () => {
    const p2025 = Object.assign(new Error('record not found'), { code: 'P2025' })
    const db = makeSourceDb()
    db.source.update.mockRejectedValueOnce(p2025)
    const repo = new PrismaSourceRepository(db as never)

    await expect(
      repo.markActive('gone-id', { listingCount: 1, fingerprintHash: 'h', isCompleteCrawl: true }),
    ).resolves.toBeUndefined()
  })

  it('still throws for non-P2025 errors', async () => {
    const connectionError = Object.assign(new Error('connection closed'), { code: 'P1001' })
    const db = makeSourceDb()
    db.source.update.mockRejectedValueOnce(connectionError)
    const repo = new PrismaSourceRepository(db as never)

    await expect(repo.markError('some-id', 'boom')).rejects.toMatchObject({ code: 'P1001' })
  })
})
