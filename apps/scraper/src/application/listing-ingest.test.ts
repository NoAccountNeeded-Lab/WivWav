import { describe, it, expect, vi } from 'vitest'
import { ingestListing } from './listing-ingest.js'
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

  return {
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
  }
}

function makeStatefulDb() {
  let state: Record<string, unknown> | null = null

  const db = {
    listing: {
      findUnique: vi.fn().mockImplementation(async () => state),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        state = { id: 'list-created', status: 'active', ...data }
        return { id: 'list-created' }
      }),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (state === null) throw new Error('Cannot update a missing listing')
        state = { ...state, ...data }
        return state
      }),
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
  }

  return {
    db,
    getState: () => state,
    applyDetailExtraction: (values: Record<string, unknown>) => {
      if (state === null) throw new Error('Cannot apply detail extraction to a missing listing')
      state = { ...state, ...values }
    },
  }
}

describe('ingestListing', () => {
  describe('upsert price history', () => {
    it('writes a history row when price changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listingPriceHistory.create).toHaveBeenCalledWith({
        data: { listingId: 'list-1', priceCents: 3000000 },
      })
    })

    it('does not write a history row when price is unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })

    it('does not write a history row for a new listing (create path)', async () => {
      const db = makeDb(null)
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      // priceHistory nested create handles the initial row via the upsert create branch
      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })

    it('does not write a history row when new price is null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })
      await ingestListing(db as never, makeListing({ priceCents: null }))

      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
    })
  })

  describe('upsert mileage history', () => {
    it('writes a history row when mileage changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 25000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listingMileageHistory.create).toHaveBeenCalledWith({
        data: { listingId: 'list-1', mileage: 30000 },
      })
    })

    it('does not write a history row when mileage is unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 30000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listingMileageHistory.create).not.toHaveBeenCalled()
    })

    it('writes the DB when only mileage changed', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 25000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000, mileage: 30000 }))

      expect(db.listing.update).toHaveBeenCalled()
    })

    it('does not write a history row when changed mileage is null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, mileage: 30000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000, mileage: null }))

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
      await ingestListing(db as never, makeListing({
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
      await ingestListing(db as never, makeListing({
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
      await ingestListing(db as never, makeListing({
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
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('skips the DB write when listing exists with null price and scraped price is also null', async () => {
      const db = makeDb({ id: 'list-1', priceCents: null })
      await ingestListing(db as never, makeListing({ priceCents: null }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('writes the DB when listing exists and price changed', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

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
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

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
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('writes the DB and updates sourceUrl when the listing slug changes on re-scrape', async () => {
      const db = makeDb({ id: 'list-1', sourceUrl: 'http://example.com/old-slug', priceCents: 3000000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000, sourceUrl: 'http://example.com/new-slug' }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sourceUrl: 'http://example.com/new-slug' }),
      }))
    })

    it('preserves an enriched buyer URL when updating other listing data', async () => {
      const enrichedUrl = 'https://dealer.example.com/inventory/5TDYRKEC8RS205440'
      const db = makeDb({ id: 'list-1', buyerUrl: enrichedUrl, priceCents: 2500000 })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ buyerUrl: enrichedUrl }),
      }))
    })

    it('writes the DB for a new listing', async () => {
      const db = makeDb(null)
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.create).toHaveBeenCalled()
    })

    it('writes the DB when listing was possibly_gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalled()
    })

    it('writes the DB when listing was gone and reappears (same price)', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

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

      const result = await ingestListing(db as never, makeListing(overrides))

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

      await expect(ingestListing(db as never, makeListing({ priceCents: 3000000, color: null }))).resolves.toEqual({
        listingId: 'list-1',
        outcome: 'unchanged',
        changedFields: [],
      })
      expect(db.listing.update).not.toHaveBeenCalled()
    })

    it('keeps a detail-extracted color intact when another field changes on the same recrawl', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, color: 'White' })

      await ingestListing(db as never, makeListing({ priceCents: 3000000, color: null }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ color: 'White' }),
      }))
    })

    it('still applies a genuine color correction from the card payload', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, color: 'White' })

      await ingestListing(db as never, makeListing({ priceCents: 3000000, color: 'Midnight Blue' }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ color: 'Midnight Blue' }),
      }))
    })

    it.each([
      { field: 'rampType', detailValue: 'fold_out' },
      { field: 'wavFeatures', detailValue: ['has_lift', 'transfer_seat'] },
      { field: 'floorLoweringInches', detailValue: 14 },
      { field: 'wheelchairCapacity', detailValue: 2 },
    ])('preserves detail-extracted $field through create, detail extraction, and card recrawl', async ({
      field,
      detailValue,
    }) => {
      const detailScrapedAt = new Date('2026-07-03T18:00:00Z')
      const { db, getState, applyDetailExtraction } = makeStatefulDb()

      await expect(ingestListing(db as never, makeListing())).resolves.toMatchObject({ outcome: 'created' })
      applyDetailExtraction({ [field]: detailValue, detailScrapedAt })

      await expect(ingestListing(db as never, makeListing())).resolves.toEqual({
        listingId: 'list-created',
        outcome: 'unchanged',
        changedFields: [],
      })

      expect(getState()).toEqual(expect.objectContaining({
        [field]: detailValue,
        detailScrapedAt,
      }))
      expect(db.listing.update).not.toHaveBeenCalled()
      expect(db.listingConversionHistory.create).not.toHaveBeenCalled()
      expect(db.listingObservation.create).toHaveBeenCalledTimes(1)
    })

    it('preserves all accessibility absence placeholders when another card field changes', async () => {
      const db = makeDb({
        id: 'list-1',
        priceCents: 2500000,
        rampType: 'fold_out',
        wavFeatures: ['has_lift', 'transfer_seat'],
        floorLoweringInches: 14,
        wheelchairCapacity: 2,
      })

      await expect(ingestListing(db as never, makeListing({ priceCents: 3000000 }))).resolves.toEqual({
        listingId: 'list-1',
        outcome: 'updated',
        changedFields: ['priceCents'],
      })

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          rampType: 'fold_out',
          wavFeatures: ['has_lift', 'transfer_seat'],
          floorLoweringInches: 14,
          wheelchairCapacity: 2,
        }),
      }))
      expect(db.listingConversionHistory.create).not.toHaveBeenCalled()
      expect(db.listingObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changedFields: ['priceCents'],
          after: expect.objectContaining({
            rampType: 'fold_out',
            wavFeatures: ['has_lift', 'transfer_seat'],
            floorLoweringInches: 14,
            wheelchairCapacity: 2,
          }),
        }),
      })
    })

    it.each([
      { field: 'rampType', previous: 'fold_out', observed: 'in_floor' },
      { field: 'wavFeatures', previous: ['has_lift'], observed: ['hand_controls'] },
      { field: 'floorLoweringInches', previous: 10, observed: 14 },
      { field: 'wheelchairCapacity', previous: 1, observed: 2 },
    ])('commits a real conflicting card $field observation with audit evidence', async ({
      field,
      previous,
      observed,
    }) => {
      const db = makeDb({
        id: 'list-1',
        priceCents: 3000000,
        [field]: previous,
      })
      const wav = { ...makeListing().wav, [field]: observed }

      await expect(ingestListing(db as never, makeListing({ wav }))).resolves.toMatchObject({
        outcome: 'updated',
        changedFields: expect.arrayContaining([field]),
      })

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          [field]: observed,
          publicationStatus: 'pending',
        }),
      }))
      expect(db.listingConversionHistory.create).toHaveBeenCalledTimes(1)
      expect(db.listingObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changedFields: expect.arrayContaining([field]),
          before: expect.objectContaining({ [field]: previous }),
          after: expect.objectContaining({ [field]: observed }),
        }),
      })
    })

    it('clears stale geocoding when a source-owned location changes', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, city: 'Old City' })

      await ingestListing(db as never, makeListing({ location: { zip: '80202', city: 'Denver', state: 'CO', lat: null, lng: null } }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ lat: null, lng: null }),
      }))
    })

    it('returns unchanged without duplicate history or observation rows', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000 })

      await expect(ingestListing(db as never, makeListing())).resolves.toEqual({
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

  describe('idempotent re-ingest', () => {
    it('re-ingesting the identical payload twice writes no duplicate price/mileage/conversion history rows', async () => {
      const { db, getState } = makeStatefulDb()
      const listing = makeListing({
        priceCents: 3000000,
        mileage: 25000,
        wav: {
          conversionType: 'rear_entry',
          conversionManufacturer: 'BraunAbility',
          floorLoweringInches: 12,
          rampType: 'fold_out',
          conversionStatus: 'complete',
          wavFeatures: ['has_lift'],
          wheelchairCapacity: 1,
        },
      })

      const first = await ingestListing(db as never, listing)
      expect(first.outcome).toBe('created')

      const second = await ingestListing(db as never, listing)
      expect(second).toEqual({ listingId: 'list-created', outcome: 'unchanged', changedFields: [] })

      // The initial create writes price/mileage/conversion history as nested
      // creates on tx.listing.create, not via the standalone history-model
      // creates below — those must stay untouched on an unchanged re-ingest.
      expect(db.listingPriceHistory.create).not.toHaveBeenCalled()
      expect(db.listingMileageHistory.create).not.toHaveBeenCalled()
      expect(db.listingConversionHistory.create).not.toHaveBeenCalled()
      expect(db.listingObservation.create).toHaveBeenCalledTimes(1)
      expect(db.listing.update).not.toHaveBeenCalled()
      expect(getState()).toMatchObject({ id: 'list-created' })
    })
  })

  describe('upsert detailScrapedAt reset', () => {
    it('resets detailScrapedAt when price changes', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a possibly_gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'possibly_gone' })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('resets detailScrapedAt when a gone listing reappears', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 3000000, status: 'gone' })
      await ingestListing(db as never, makeListing({ priceCents: 3000000 }))

      expect(db.listing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ detailScrapedAt: null }),
      }))
    })

    it('does not reset detailScrapedAt when price and status are unchanged', async () => {
      const db = makeDb({ id: 'list-1', priceCents: 2500000, status: 'active' })
      // same price → early return, no upsert at all
      await ingestListing(db as never, makeListing({ priceCents: 2500000 }))

      expect(db.listing.update).not.toHaveBeenCalled()
    })
  })
})
