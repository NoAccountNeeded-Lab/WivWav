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

      expect(db.listing.update).toHaveBeenCalled()
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

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('skips the DB write when listing exists with null price and scraped price is also null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: null })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: null }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('writes the DB when listing exists and price changed', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: 'pending',
          qualityIssueCodes: [],
          qualityCheckedAt: null,
        }),
      }))
    })

    it('writes the DB when buyer URL metadata changed', async () => {
      const db = makeDb({ id: 'list-1', buyerUrl: null, priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.not.objectContaining({ detailScrapedAt: null }),
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

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('writes the DB and updates sourceUrl when the listing slug changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', sourceUrl: 'http://example.com/old-slug', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000, sourceUrl: 'http://example.com/new-slug' }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sourceUrl: 'http://example.com/new-slug' }),
      }))
    })

    it('preserves an enriched buyer URL when updating other listing data', async () => {
      const enrichedUrl = 'https://dealer.example.com/inventory/5TDYRKEC8RS205440'
      const db = makeDb({ id: 'list-1', buyerUrl: enrichedUrl, priceCents: 2500000 })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ buyerUrl: enrichedUrl }),
      }))
    })

    it('writes the DB for a new listing', async () => {
      const db = makeDb(null)
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.create).toHaveBeenCalled()
    })

    it('writes the DB when listing was possibly_gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalled()
    })

    it('writes the DB when listing was gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalled()
    })

    it.each([
      ['identity', { make: 'Honda', model: 'Odyssey', year: 2023, trim: 'EX-L', vin: '5FNRL6H70NB000001', condition: 'certified_pre_owned' as const }],
      ['accessibility classification', { wav: { ...makeListing().wav, conversionType: 'side_entry' as const, conversionManufacturer: 'VMI', conversionStatus: 'complete' as const } }],
      ['source location', { location: { zip: '80202', city: 'Denver', state: 'CO', lat: 39.7, lng: -104.9 } }],
      ['source dealer', { dealer: { name: 'Corrected Mobility', phone: null, website: null } }],
      ['card image input', { images: ['https://example.com/corrected-card.jpg'] }],
      ['card color', { color: 'Midnight Blue' }],
    ])('persists corrected %s fields and records an audit observation', async (_group, overrides) => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)

      const result = await repo.upsert(makeListing(overrides))

      expect(result.outcome).toBe('updated')
      expect(db.listing.update).toHaveBeenCalled()
      expect(db.listingObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          listingId: 'list-1',
          stage: 'list_card',
          extractionVersion: 'source-card-v1',
          changedFields: expect.any(Array),
          before: expect.any(Object),
          after: expect.any(Object),
        }),
      })
    })

    it('preserves a detail-extracted color when the card payload reports null (refs #629)', async () => {
      // BLVD's card scraper always reports color: null (it only appears on the
      // detail page); a prior detail-extract run had set the real value.
      const db = makeDb({ id: 'list-1', priceCents: 3000000, color: 'White' })
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing({ priceCents: 3000000, color: null }))).resolves.toEqual({
        listingId: 'list-1',
        outcome: 'unchanged',
        changedFields: [],
      })
      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('keeps a detail-extracted color intact when another field changes on the same recrawl', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, color: 'White' })
      const repo = new PrismaListingRepository(db as never)

      await repo.upsert(makeListing({ priceCents: 3000000, color: null }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ color: 'White' }),
      }))
    })

    it('still applies a genuine color correction from the card payload', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, color: 'White' })
      const repo = new PrismaListingRepository(db as never)

      await repo.upsert(makeListing({ priceCents: 3000000, color: 'Midnight Blue' }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ color: 'Midnight Blue' }),
      }))
    })

    it('clears stale geocoding when a source-owned location changes', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, city: 'Old City' })
      const repo = new PrismaListingRepository(db as never)

      await repo.upsert(makeListing({ location: { zip: '80202', city: 'Denver', state: 'CO', lat: null, lng: null } }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lat: null, lng: null }),
      }))
    })

    it('returns unchanged without duplicate history or observation rows', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      const repo = new PrismaListingRepository(db as never)

      await expect(repo.upsert(makeListing())).resolves.toEqual({
        listingId: 'list-1',
        outcome: 'unchanged',
        changedFields: [],
      })
      expect(db.listingObservation.create).not.toHaveBeenCalled()
      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
      expect(db.listingMileageHistory.create).not.toHaveBeenCalled()
      expect(db.listingConversionHistory.create).not.toHaveBeenCalled()
    })
  })

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
      expect(db.listingObservation.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('upsert detailScrapedAt reset', () => {
    it('resets detailScrapedAt when price changes', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a possibly_gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      const repo = new PrismaListingRepository(db as never)
      await repo.upsert(makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('does not reset detailScrapedAt when price and status are unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      const repo = new PrismaListingRepository(db as never)
      // same price → early return, no upsert at all
      await repo.upsert(makeListing({ priceCents: 2500000 }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })
  })
})
