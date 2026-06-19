import { describe, it, expect } from 'vitest'
import { toDocument } from './index.js'
import type { Listing } from '@wivwav/db'

// Minimal Listing row that satisfies the Prisma-generated type for toDocument.
function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    sourceId: 'source-1',
    sourceUrl: 'https://blvd.com/wheelchair-vans-for-sale/1FMJK1HT0MEA12345',
    buyerUrl: null,
    externalId: null,
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
    hasLift: false,
    handControls: false,
    transferSeat: false,
    wheelchairCapacity: null,
    zip: null,
    city: null,
    state: 'TX',
    lat: null,
    lng: null,
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
})
