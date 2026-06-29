import { describe, it, expect, vi } from 'vitest'
import { conversionBrandSlug, syncListings, toDocument } from './index.js'
import type { Listing } from '@wivwav/db'

// Minimal Listing row that satisfies the Prisma-generated type for toDocument.
function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    sourceId: 'source-1',
    sourceUrl: 'https://blvd.com/wheelchair-vans-for-sale/1FMJK1HT0MEA12345',
    buyerUrl: null,
    externalId: null,
    stockNumber: null,
    sourceRecordKey: '1FMJK1HT0MEA12345',
    make: 'Ford',
    model: 'Transit',
    year: 2021,
    trim: null,
    vin: '1FMJK1HT0MEA12345',
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 4500000,
    mileage: 30000,
    color: null,
    fuelType: null,
    transmission: null,
    conversionType: 'rear_entry',
    conversionManufacturer: null,
    floorLoweringInches: null,
    rampType: 'in_floor',
    conversionStatus: 'unknown',
    wavFeatures: [],
    wheelchairCapacity: null,
    zip: null,
    city: null,
    state: 'TX',
    lat: null,
    lng: null,
    vehicleId: null,
    vehicleModelId: null,
    vehicleModelMatchConfidence: null,
    dealerName: null,
    dealerPhone: null,
    dealerWebsite: null,
    images: [],
    description: null,
    isDuplicate: false,
    canonicalId: null,
    status: 'active',
    publicationStatus: 'pending',
    qualityIssueCodes: [],
    qualityCheckedAt: null,
    saleStatus: 'active',
    goneAt: null,
    soldAt: null,
    listedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    scrapedAt: new Date('2024-01-02'),
    detailScrapedAt: null,
    processingLockedAt: null,
    ...overrides,
  } as Listing
}

// ---------------------------------------------------------------------------
// toDocument — private-seller field normalization
// ---------------------------------------------------------------------------

describe('toDocument — private-seller field normalization', () => {
  it('retains dealerPhone and dealerName for dealer listings', () => {
    const row = makeListing({
      sellerType: 'dealer',
      dealerName: 'Mobility Motors',
      dealerPhone: '303-555-0101',
    })
    const doc = toDocument(row)
    expect(doc.dealerPhone).toBe('303-555-0101')
    expect(doc.dealerName).toBe('Mobility Motors')
  })

  it('suppresses dealerPhone and normalizes dealerName for private-seller listings', () => {
    const row = makeListing({
      sellerType: 'private',
      dealerName: 'Jane Smith',
      dealerPhone: '720-555-0199',
    })
    const doc = toDocument(row)
    expect(doc.dealerPhone).toBeNull()
    expect(doc.dealerName).toBe('For Sale By Owner')
  })

  it('does not alter other fields when normalizing private seller', () => {
    const row = makeListing({
      sellerType: 'private',
      dealerName: 'Jane Smith',
      dealerPhone: '720-555-0199',
      priceCents: 3500000,
      city: 'Austin',
      state: 'TX',
    })
    const doc = toDocument(row)
    expect(doc.sellerType).toBe('private')
    expect(doc.priceCents).toBe(3500000)
    expect(doc.city).toBe('Austin')
    expect(doc.state).toBe('TX')
  })

  it('leaves dealerPhone null for private seller when no phone was stored', () => {
    const row = makeListing({ sellerType: 'private', dealerPhone: null })
    const doc = toDocument(row)
    expect(doc.dealerPhone).toBeNull()
  })

  it('adds the normalized conversionBrand slug', () => {
    const row = makeListing({ conversionManufacturer: 'BraunAbility' })
    const doc = toDocument(row)
    expect(doc.conversionBrand).toBe('braunability')
  })

  it('uses vehicleId as the search grouping key when available', () => {
    const doc = toDocument(makeListing({ id: 'listing-1', vehicleId: 'vehicle-1' }))
    expect(doc.vehicleGroupKey).toBe('vehicle-1')
  })

  it('falls back to listing id as the search grouping key without vehicle identity', () => {
    const doc = toDocument(makeListing({ id: 'listing-1', vehicleId: null }))
    expect(doc.vehicleGroupKey).toBe('listing-1')
  })

  it('includes publication status for defense-in-depth search filtering', () => {
    const doc = toDocument(makeListing({ publicationStatus: 'eligible' }))
    expect(doc.publicationStatus).toBe('eligible')
  })
})

describe('conversionBrandSlug', () => {
  it('normalizes brand names to URL-safe slugs', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Freedom Motors')).toBe('freedom-motors')
    expect(conversionBrandSlug('AMS Vans')).toBe('ams-vans')
  })

  it('maps common aliases to seeded brand slugs', () => {
    expect(conversionBrandSlug('Rollx')).toBe('rollx-vans')
    expect(conversionBrandSlug('AMS')).toBe('ams-vans')
    expect(conversionBrandSlug('Freedom')).toBe('freedom-motors')
    expect(conversionBrandSlug('Vantage')).toBe('vantage-mobility')
    expect(conversionBrandSlug('Vantage Mobility International')).toBe('vantage-mobility')
  })

  it('returns null for missing or blank values', () => {
    expect(conversionBrandSlug(null)).toBeNull()
    expect(conversionBrandSlug(undefined)).toBeNull()
    expect(conversionBrandSlug('   ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// toDocument — wavFeatures array
// ---------------------------------------------------------------------------

describe('toDocument — wavFeatures', () => {
  it('passes through an empty wavFeatures array', () => {
    const row = makeListing({ wavFeatures: [] })
    const doc = toDocument(row)
    expect(doc.wavFeatures).toEqual([])
  })

  it('passes through a populated wavFeatures array', () => {
    const row = makeListing({ wavFeatures: ['hand_controls', 'has_lift'] as never })
    const doc = toDocument(row)
    expect(doc.wavFeatures).toEqual(['hand_controls', 'has_lift'])
  })

  it('does not include hasLift, handControls, or transferSeat fields', () => {
    const doc = toDocument(makeListing())
    expect(doc).not.toHaveProperty('hasLift')
    expect(doc).not.toHaveProperty('handControls')
    expect(doc).not.toHaveProperty('transferSeat')
  })
})

// ---------------------------------------------------------------------------
// toDocument — canonicalization (refs #515)
// ---------------------------------------------------------------------------

describe('toDocument — canonical color', () => {
  it('collapses marketing suffix from color field', () => {
    const doc = toDocument(makeListing({ color: 'Silver Metallic' }))
    expect(doc.color).toBe('Silver')
  })

  it('applies color alias (Oxford White → White)', () => {
    const doc = toDocument(makeListing({ color: 'Oxford White' }))
    expect(doc.color).toBe('White')
  })

  it('returns null color for missing-value token in color', () => {
    const doc = toDocument(makeListing({ color: 'unknown' }))
    expect(doc.color).toBeNull()
  })

  it('passes through null color when no color is stored', () => {
    const doc = toDocument(makeListing({ color: null }))
    expect(doc.color).toBeNull()
  })
})

describe('toDocument — canonical fuelType', () => {
  it('returns null fuelType when fuelType is an engine description (refs #515)', () => {
    const doc = toDocument(makeListing({ fuelType: '3.5L V6 DOHC' }))
    expect(doc.fuelType).toBeNull()
  })

  it('returns canonical fuelType for an explicit fuel type label', () => {
    const doc = toDocument(makeListing({ fuelType: 'Gasoline' }))
    expect(doc.fuelType).toBe('gasoline')
  })

  it('derives fuelType from engine field when fuelType is null', () => {
    // The engine field is new in the DB schema (refs #515). toDocument reads it when present.
    const rowWithEngine = { ...makeListing({ fuelType: null }), engine: 'Electric Motor 150kW' }
    const doc = toDocument(rowWithEngine as never)
    expect(doc.fuelType).toBe('electric')
  })

  it('returns null fuelType when neither fuelType nor engine provides a fuel type', () => {
    const rowWithEngine = { ...makeListing({ fuelType: null }), engine: '3.5L V6 DOHC' }
    const doc = toDocument(rowWithEngine as never)
    expect(doc.fuelType).toBeNull()
  })
})

describe('toDocument — canonical conversion manufacturer', () => {
  it('rejects year numbers in conversionManufacturer', () => {
    const doc = toDocument(makeListing({ conversionManufacturer: '2026' }))
    expect(doc.conversionManufacturer).toBeNull()
    expect(doc.conversionBrand).toBeNull()
  })

  it('rejects generic WAV text in conversionManufacturer', () => {
    const doc = toDocument(makeListing({ conversionManufacturer: 'Wheelchair' }))
    expect(doc.conversionManufacturer).toBeNull()
  })

  it('rejects missing-value tokens in conversionManufacturer', () => {
    const doc = toDocument(makeListing({ conversionManufacturer: 'undefined' }))
    expect(doc.conversionManufacturer).toBeNull()
  })

  it('retains known converter names', () => {
    const doc = toDocument(makeListing({ conversionManufacturer: 'BraunAbility' }))
    expect(doc.conversionManufacturer).toBe('BraunAbility')
  })
})

describe('toDocument — canonical make/model', () => {
  it('normalizes make casing', () => {
    const doc = toDocument(makeListing({ make: 'FORD' }))
    expect(doc.make).toBe('Ford')
  })

  it('resolves Mercedes alias', () => {
    const doc = toDocument(makeListing({ make: 'Mercedes' }))
    expect(doc.make).toBe('Mercedes-Benz')
  })

  it('resolves Grand Caravan model alias', () => {
    const doc = toDocument(makeListing({ model: 'GRAND CARAVAN' }))
    expect(doc.model).toBe('Grand Caravan')
  })

  it('resolves T-350 model alias to Transit', () => {
    const doc = toDocument(makeListing({ model: 'T-350' }))
    expect(doc.model).toBe('Transit')
  })

  it('resolves Town and Country alias', () => {
    const doc = toDocument(makeListing({ model: 'Town and Country' }))
    expect(doc.model).toBe('Town & Country')
  })
})

describe('syncListings — publication eligibility', () => {
  it('upserts only eligible active listings', async () => {
    const row = makeListing({ id: 'eligible-1', publicationStatus: 'eligible' })
    const findMany = vi.fn(async () => [row])
    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = {
      index: vi.fn(() => ({ addDocuments, deleteDocuments })),
    }

    await syncListings(
      ['eligible-1'],
      { listing: { findMany } } as never,
      client as never,
    )

    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['eligible-1'] },
        status: 'active',
        publicationStatus: 'eligible',
      },
    })
    expect(addDocuments).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'eligible-1', publicationStatus: 'eligible' })],
      { primaryKey: 'id' },
    )
    expect(deleteDocuments).not.toHaveBeenCalled()
  })

  it('removes requested ids that are not eligible and active', async () => {
    const findMany = vi.fn(async () => [])
    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = {
      index: vi.fn(() => ({ addDocuments, deleteDocuments })),
    }

    await syncListings(
      ['pending-1', 'gone-1'],
      { listing: { findMany } } as never,
      client as never,
    )

    expect(addDocuments).not.toHaveBeenCalled()
    expect(deleteDocuments).toHaveBeenCalledWith(['pending-1', 'gone-1'])
  })
})
