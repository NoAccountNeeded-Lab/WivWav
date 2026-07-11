import { describe, it, expect, vi } from 'vitest'
import { conversionBrandSlug, listingCompletenessScore, mileageBucket, selectRepresentative, syncListings, toDocument } from './index.js'
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
    engine: null,
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

// Smoke test only — conversionBrandSlug's full behavior (aliasing, edge cases)
// is implemented and tested in ./canonicalize.ts / ./canonicalize.test.ts; this
// just confirms the re-export from this module still works.
describe('conversionBrandSlug (re-export smoke test)', () => {
  it('normalizes and aliases via the shared canonicalize.ts implementation', () => {
    expect(conversionBrandSlug(' BraunAbility ')).toBe('braunability')
    expect(conversionBrandSlug('Rollx')).toBe('rollx-vans')
    expect(conversionBrandSlug(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mileageBucket
// ---------------------------------------------------------------------------

describe('mileageBucket', () => {
  it('returns null for a null mileage', () => {
    expect(mileageBucket(null)).toBeNull()
  })

  it('buckets in 12,000-mile widths, matching the standard annual-mileage benchmark', () => {
    expect(mileageBucket(0)).toBe('0-12000')
    expect(mileageBucket(11999)).toBe('0-12000')
    expect(mileageBucket(12000)).toBe('12000-24000')
    expect(mileageBucket(23999)).toBe('12000-24000')
    expect(mileageBucket(24000)).toBe('24000-36000')
  })

  it('accepts a custom bucket size', () => {
    expect(mileageBucket(45000, 25000)).toBe('25000-50000')
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

  it('derives fuelType from engine field when fuelType is null (refs #515)', () => {
    const doc = toDocument(makeListing({ fuelType: null, engine: 'Electric Motor 150kW' } as never))
    expect(doc.fuelType).toBe('electric')
  })

  it('returns null fuelType when neither fuelType nor engine provides a fuel type', () => {
    const doc = toDocument(makeListing({ fuelType: null, engine: '3.5L V6 DOHC' } as never))
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

// ---------------------------------------------------------------------------
// listingCompletenessScore
// ---------------------------------------------------------------------------

describe('listingCompletenessScore', () => {
  it('returns 0 for a listing with no optional fields populated', () => {
    const listing = makeListing({
      trim: null, vin: null, priceCents: null, mileage: null,
      color: null, fuelType: null, transmission: null,
      conversionManufacturer: null, floorLoweringInches: null,
      wheelchairCapacity: null, zip: null, city: null, state: null,
      lat: null, lng: null, dealerName: null, dealerPhone: null,
      dealerWebsite: null, description: null, detailScrapedAt: null,
      images: [],
    })
    expect(listingCompletenessScore(listing)).toBe(0)
  })

  it('counts each non-null optional field', () => {
    const listing = makeListing({ trim: 'XLT', priceCents: 4500000, images: [] })
    const base = listingCompletenessScore(makeListing({ trim: null, priceCents: null, images: [] }))
    expect(listingCompletenessScore(listing)).toBe(base + 2)
  })

  it('counts each image URL', () => {
    const listing = makeListing({ images: ['img1.jpg', 'img2.jpg', 'img3.jpg'] })
    const noImages = makeListing({ images: [] })
    expect(listingCompletenessScore(listing)).toBe(listingCompletenessScore(noImages) + 3)
  })
})

// ---------------------------------------------------------------------------
// selectRepresentative
// ---------------------------------------------------------------------------

describe('selectRepresentative', () => {
  it('selects the listing with the highest completeness score', () => {
    const low = makeListing({ id: 'low', vehicleId: 'v1', images: [], priceCents: null })
    const high = makeListing({ id: 'high', vehicleId: 'v1', images: ['img.jpg'], priceCents: 4500000 })
    expect(selectRepresentative([low, high]).id).toBe('high')
  })

  it('breaks completeness ties by most recent scrapedAt', () => {
    const older = makeListing({ id: 'older', vehicleId: 'v1', scrapedAt: new Date('2024-01-01'), images: [] })
    const newer = makeListing({ id: 'newer', vehicleId: 'v1', scrapedAt: new Date('2024-06-01'), images: [] })
    // Both have same completeness score (both have same fields populated)
    const oldScore = listingCompletenessScore(older)
    const newScore = listingCompletenessScore(newer)
    expect(oldScore).toBe(newScore)
    expect(selectRepresentative([older, newer]).id).toBe('newer')
  })

  it('breaks completeness and freshness ties by lexicographic ascending id', () => {
    const ts = new Date('2024-06-01')
    const listingB = makeListing({ id: 'listing-b', vehicleId: 'v1', scrapedAt: ts, images: [] })
    const listingA = makeListing({ id: 'listing-a', vehicleId: 'v1', scrapedAt: ts, images: [] })
    expect(selectRepresentative([listingB, listingA]).id).toBe('listing-a')
  })

  it('is deterministic regardless of input order', () => {
    const ts = new Date('2024-06-01')
    const a = makeListing({ id: 'a', vehicleId: 'v1', scrapedAt: ts, images: [] })
    const b = makeListing({ id: 'b', vehicleId: 'v1', scrapedAt: ts, images: [] })
    const c = makeListing({ id: 'c', vehicleId: 'v1', scrapedAt: ts, images: [] })
    const result1 = selectRepresentative([a, b, c]).id
    const result2 = selectRepresentative([c, a, b]).id
    const result3 = selectRepresentative([b, c, a]).id
    expect(result1).toBe(result2)
    expect(result2).toBe(result3)
  })

  it('returns the sole listing when given a single-element array', () => {
    const listing = makeListing({ id: 'solo', vehicleId: 'v1' })
    expect(selectRepresentative([listing]).id).toBe('solo')
  })

  it('prefers higher completeness score over newer scrapedAt', () => {
    // Newer but sparse listing should lose to older but richer listing.
    const rich = makeListing({
      id: 'rich',
      vehicleId: 'v1',
      scrapedAt: new Date('2024-01-01'),
      priceCents: 4500000,
      mileage: 30000,
      trim: 'XLT',
      images: ['img1.jpg'],
    })
    const sparse = makeListing({
      id: 'sparse',
      vehicleId: 'v1',
      scrapedAt: new Date('2024-12-01'),
      priceCents: null,
      mileage: null,
      trim: null,
      images: [],
    })
    expect(selectRepresentative([rich, sparse]).id).toBe('rich')
  })
})

// ---------------------------------------------------------------------------
// syncListings — representative selection and publication eligibility
// ---------------------------------------------------------------------------

describe('syncListings — publication eligibility', () => {
  it('upserts the eligible ungrouped listing and does not delete', async () => {
    const row = makeListing({ id: 'eligible-1', vehicleId: null, publicationStatus: 'eligible' })
    // Call 1: discover vehicleIds (select: { id, vehicleId })
    // Call 2: ungrouped eligible fetch
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'eligible-1', vehicleId: null }])
      .mockResolvedValueOnce([row])
    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['eligible-1'],
      { listing: { findMany } } as never,
      client as never,
    )

    expect(addDocuments).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'eligible-1' })],
      { primaryKey: 'id' },
    )
    expect(deleteDocuments).not.toHaveBeenCalled()
  })

  it('removes ineligible ids that fail the active + eligible gate', async () => {
    // Call 1: discover vehicleIds (returns rows with no vehicleId)
    // Call 2: ungrouped eligible fetch (returns empty — both are ineligible)
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        { id: 'pending-1', vehicleId: null },
        { id: 'gone-1', vehicleId: null },
      ])
      .mockResolvedValueOnce([])
    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['pending-1', 'gone-1'],
      { listing: { findMany } } as never,
      client as never,
    )

    expect(addDocuments).not.toHaveBeenCalled()
    expect(deleteDocuments).toHaveBeenCalledWith(expect.arrayContaining(['pending-1', 'gone-1']))
  })
})

describe('syncListings — verified vehicle group representative selection', () => {
  it('uploads only the representative for a verified vehicle group', async () => {
    const vehicleId = 'vehicle-1'
    const rich = makeListing({
      id: 'listing-rich',
      vehicleId,
      publicationStatus: 'eligible',
      priceCents: 4500000,
      mileage: 30000,
      trim: 'XLT',
      images: ['img.jpg'],
    })
    const sparse = makeListing({
      id: 'listing-sparse',
      vehicleId,
      publicationStatus: 'eligible',
      priceCents: null,
      mileage: null,
      trim: null,
      images: [],
    })

    const findMany = vi.fn()
      // Call 1: discover vehicleIds
      .mockResolvedValueOnce([
        { id: 'listing-rich', vehicleId },
        { id: 'listing-sparse', vehicleId },
      ])
      // Call 2: all eligible in the vehicle group
      .mockResolvedValueOnce([rich, sparse])

    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['listing-rich', 'listing-sparse'],
      { listing: { findMany } } as never,
      client as never,
    )

    // Only the richer listing should be upserted.
    expect(addDocuments).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'listing-rich' })],
      { primaryKey: 'id' },
    )
    // Non-representative must be scheduled for deletion.
    expect(deleteDocuments).toHaveBeenCalledWith(expect.arrayContaining(['listing-sparse']))
  })

  it('turns over the representative when the prior rep becomes ineligible', async () => {
    const vehicleId = 'vehicle-1'
    const newRep = makeListing({
      id: 'listing-b',
      vehicleId,
      publicationStatus: 'eligible',
      priceCents: 4500000,
      images: [],
    })

    const findMany = vi.fn()
      // Call 1: discover vehicleIds — both listings touched (rep went gone)
      .mockResolvedValueOnce([
        { id: 'listing-a', vehicleId },
        { id: 'listing-b', vehicleId },
      ])
      // Call 2: eligible group members — only listing-b survives
      .mockResolvedValueOnce([newRep])

    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['listing-a', 'listing-b'],
      { listing: { findMany } } as never,
      client as never,
    )

    // New representative is upserted.
    expect(addDocuments).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'listing-b' })],
      { primaryKey: 'id' },
    )
    // Prior representative (now ineligible) is deleted.
    expect(deleteDocuments).toHaveBeenCalledWith(expect.arrayContaining(['listing-a']))
  })

  it('deletes all group members when every member becomes ineligible simultaneously', async () => {
    const vehicleId = 'vehicle-1'

    const findMany = vi.fn()
      // Call 1: discover vehicleIds — both listings touched
      .mockResolvedValueOnce([
        { id: 'listing-a', vehicleId },
        { id: 'listing-b', vehicleId },
      ])
      // Call 2: eligible group fetch — empty, both are now ineligible
      .mockResolvedValueOnce([])

    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['listing-a', 'listing-b'],
      { listing: { findMany } } as never,
      client as never,
    )

    // Nothing to upsert.
    expect(addDocuments).not.toHaveBeenCalled()
    // Both touched IDs must be deleted.
    expect(deleteDocuments).toHaveBeenCalledWith(
      expect.arrayContaining(['listing-a', 'listing-b']),
    )
  })

  it('keeps candidate listings separately visible in search', async () => {
    // Two listings with no vehicleId (candidate decision exists but vehicleId not assigned)
    const candidateA = makeListing({ id: 'cand-a', vehicleId: null, publicationStatus: 'eligible' })
    const candidateB = makeListing({ id: 'cand-b', vehicleId: null, publicationStatus: 'eligible' })

    const findMany = vi.fn()
      // Call 1: discover vehicleIds — both have no vehicleId
      .mockResolvedValueOnce([
        { id: 'cand-a', vehicleId: null },
        { id: 'cand-b', vehicleId: null },
      ])
      // Call 2: ungrouped eligible fetch
      .mockResolvedValueOnce([candidateA, candidateB])

    const addDocuments = vi.fn(async () => ({}))
    const deleteDocuments = vi.fn(async () => ({}))
    const client = { index: vi.fn(() => ({ addDocuments, deleteDocuments })) }

    await syncListings(
      ['cand-a', 'cand-b'],
      { listing: { findMany } } as never,
      client as never,
    )

    // Both candidates are upserted as independent documents.
    expect(addDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cand-a' }),
        expect.objectContaining({ id: 'cand-b' }),
      ]),
      { primaryKey: 'id' },
    )
    expect(deleteDocuments).not.toHaveBeenCalled()
  })
})
