import { describe, it, expect, vi } from 'vitest'
import { PrismaListingRepository } from './prisma-repositories.js'
import type { ListingUpsertData } from '../engine/repositories.js'

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
  existingListing: {
    id: string
    sourceUrl?: string | null
    buyerUrl?: string | null
    sellerType?: 'dealer' | 'private'
    priceCents: number | null
    mileage?: number | null
    conversionStatus?: 'proposed' | 'complete' | 'unknown'
    wavFeatures?: string[]
    status?: string
  } | null = null,
) {
  const existing = existingListing
    ? {
        sourceUrl: 'http://example.com/1',
        buyerUrl: 'http://example.com/1',
        sellerType: 'dealer' as const,
        status: 'active',
        mileage: null,
        conversionStatus: 'unknown' as const,
        wavFeatures: [],
        ...existingListing,
      }
    : null

  return {
    listing: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockResolvedValue({}),
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
  }
}

describe('PrismaListingRepository', () => {
  describe('upsert price history', () => {
    it('writes a history row when price changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listingPriceHistory.create).toHaveBeenCalledWith({
        data: { listingId: 'list-1', priceCents: 3000000 },
      })
    })

    it('does not write a history row when price is unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })

    it('does not write a history row for a new listing (create path)', async () => {
      const db = makeDb(null)
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      // priceHistory nested create handles the initial row via the upsert create branch
      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })

    it('does not write a history row when new price is null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: null }))

      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })
  })

  describe('upsert mileage history', () => {
    it('writes a history row when mileage changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 25000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listingMileageHistory.create).toHaveBeenCalledWith({
        data: { listingId: 'list-1', mileage: 30000 },
      })
    })

    it('does not write a history row when mileage is unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 30000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listingMileageHistory.create).not.toHaveBeenCalled()
    })

    it('writes the DB when only mileage changed', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 25000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listing.upsert).toHaveBeenCalled()
    })

    it('does not write a history row when changed mileage is null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 30000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, mileage: null }))

      expect(db.listingMileageHistory.create).not.toHaveBeenCalled()
    })
  })

  describe('upsert conversion history', () => {
    it('writes a history row when conversion status changes on re-scrape', async () => {
      const db = makeDb({
        id: 'list-1',
        priceCents: 3000000,
        conversionStatus: 'proposed',
        wavFeatures: [],
      })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({
        priceCents: 3000000,
        wav: {
          conversionType: 'unknown',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'unknown',
          conversionStatus: 'complete',
          wavFeatures: [],
          wheelchairCapacity: null,
        },
      }))

      expect(db.listingConversionHistory.create).toHaveBeenCalledWith({
        data: { listingId: 'list-1', conversionStatus: 'complete', wavFeatures: [] },
      })
    })

    it('writes a history row with the full wavFeatures array when features change', async () => {
      const db = makeDb({
        id: 'list-1',
        priceCents: 3000000,
        conversionStatus: 'complete',
        wavFeatures: ['has_lift'],
      })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({
        priceCents: 3000000,
        wav: {
          conversionType: 'unknown',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'unknown',
          conversionStatus: 'complete',
          wavFeatures: ['has_lift', 'hand_controls', 'transfer_seat'],
          wheelchairCapacity: null,
        },
      }))

      expect(db.listingConversionHistory.create).toHaveBeenCalledWith({
        data: {
          listingId: 'list-1',
          conversionStatus: 'complete',
          wavFeatures: ['has_lift', 'hand_controls', 'transfer_seat'],
        },
      })
    })

    it('does not write a history row when conversion observation is unchanged', async () => {
      const db = makeDb({
        id: 'list-1',
        priceCents: 3000000,
        conversionStatus: 'complete',
        wavFeatures: ['has_lift', 'hand_controls'],
      })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({
        priceCents: 3000000,
        wav: {
          conversionType: 'unknown',
          conversionManufacturer: null,
          floorLoweringInches: null,
          rampType: 'unknown',
          conversionStatus: 'complete',
          wavFeatures: ['hand_controls', 'has_lift'],
          wheelchairCapacity: null,
        },
      }))

      expect(db.listingConversionHistory.create).not.toHaveBeenCalled()
    })
  })

  describe('upsert skip for unchanged listings', () => {
    it('skips the DB write when listing exists with same price', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).not.toHaveBeenCalled()
    })

    it('skips the DB write when listing exists with null price and scraped price is also null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: null })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: null }))

      expect(db.listing.upsert).not.toHaveBeenCalled()
    })

    it('writes the DB when listing exists and price changed', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalled()
    })

    it('writes the DB when buyer URL metadata changed', async () => {
      const db = makeDb({ id: 'list-1', buyerUrl: null, priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.not.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('skips the DB write when a source fallback buyer URL would replace an enriched buyer URL', async () => {
      const db = makeDb({
        id: 'list-1',
        buyerUrl: 'https://dealer.example.com/inventory/5TDYRKEC8RS205440',
        priceCents: 3000000,
      })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).not.toHaveBeenCalled()
    })

    it('writes the DB and updates sourceUrl when the listing slug changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', sourceUrl: 'http://example.com/old-slug', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, sourceUrl: 'http://example.com/new-slug' }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ sourceUrl: 'http://example.com/new-slug' }),
      }))
    })

    it('preserves an enriched buyer URL when updating other listing data', async () => {
      const enrichedUrl = 'https://dealer.example.com/inventory/5TDYRKEC8RS205440'
      const db = makeDb({ id: 'list-1', buyerUrl: enrichedUrl, priceCents: 2500000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ buyerUrl: enrichedUrl }),
      }))
    })

    it('writes the DB for a new listing', async () => {
      const db = makeDb(null)
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalled()
    })

    it('writes the DB when listing was possibly_gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalled()
    })

    it('writes the DB when listing was gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalled()
    })
  })

  describe('upsert P2028 transient retry', () => {
    // These tests use real timers; withTransientRetry backs off 100ms then 200ms on retry.
    // Total delay per test is at most 300ms — acceptable for a unit suite.

    it('retries and succeeds when the first upsert attempt throws P2028', async () => {
      const p2028 = Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' })
      const db = makeDb(null)
      // First call throws P2028, second call succeeds
      db.listing.upsert
        .mockRejectedValueOnce(p2028)
        .mockResolvedValueOnce({})
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).resolves.toBeUndefined()
      expect(db.listing.upsert).toHaveBeenCalledTimes(2)
    }, 1000)

    it('propagates P2028 after exhausting all retry attempts', async () => {
      const p2028 = Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' })
      const db = makeDb(null)
      db.listing.upsert.mockRejectedValue(p2028)
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).rejects.toMatchObject({ code: 'P2028' })
      expect(db.listing.upsert).toHaveBeenCalledTimes(3)
    }, 1000)

    it('does not retry on non-transient errors (e.g. P2002 unique constraint)', async () => {
      const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      const db = makeDb(null)
      db.listing.upsert.mockRejectedValue(uniqueViolation)
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000 }))).rejects.toMatchObject({ code: 'P2002' })
      expect(db.listing.upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('upsert detailScrapedAt reset', () => {
    it('resets detailScrapedAt when price changes', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a possibly_gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('does not reset detailScrapedAt when price and status are unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      const repo = new PrismaListingRepository(db as never)
      // same price → early return, no upsert at all
      await repo.upsert(makeListing({ priceCents: 2500000 }))

      expect(db.listing.upsert).not.toHaveBeenCalled()
    })
  })
})
