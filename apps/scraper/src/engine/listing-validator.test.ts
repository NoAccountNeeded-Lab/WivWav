import { describe, it, expect } from 'vitest'
import { validateListing, summarizeQuality, SYSTEMIC_ERROR_THRESHOLD } from './listing-validator.js'
import type { ListingUpsertData } from './repositories.js'

function makeListing(overrides: Partial<ListingUpsertData> = {}): ListingUpsertData {
  return {
    sourceId: 'mobilityworks',
    sourceUrl: 'https://www.mobilityworks.com/vans/2024-toyota-sienna-5TDYRKEC8RS205440/',
    buyerUrl: 'https://www.mobilityworks.com/vans/2024-toyota-sienna-5TDYRKEC8RS205440/',
    externalId: 'RS205440',
    stockNumber: 'RS205440',
    sourceRecordKey: 'RS205440',
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    trim: 'FWD XLE',
    vin: '5TDYRKEC8RS205440',
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 7199100,
    mileage: 50094,
    color: 'Grey',
    fuelType: null,
    transmission: null,
    wav: {
      conversionType: 'rear_entry',
      conversionManufacturer: 'Driverge',
      floorLoweringInches: null,
      rampType: 'fold_out',
      conversionStatus: 'unknown' as const,
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city: 'North Las Vegas', state: 'NV', lat: null, lng: null },
    dealer: { name: 'MobilityWorks', phone: null, website: 'https://www.mobilityworks.com' },
    images: [],
    description: null,
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    ...overrides,
  }
}

// ─── validateListing ──────────────────────────────────────────────────────────

describe('validateListing', () => {
  it('returns no issues for a clean listing', () => {
    expect(validateListing(makeListing())).toHaveLength(0)
  })

  it('returns error when sourceRecordKey contains a space', () => {
    const issues = validateListing(makeListing({
      sourceRecordKey: 'RS205440 Mileage50094 ColorGrey Conv MakeDriverge ConversionRear Entry Manual Fold Out LocationNorth Las Vegas NV (Las Vegas)    Stock: RS205440 Request Information Schedule a Test Drive',
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.field).toBe('sourceRecordKey')
    expect(issues[0]!.rule).toBe('contains_space')
    expect(issues[0]!.severity).toBe('error')
  })

  it('detects field_label_bleed in conversionManufacturer', () => {
    const issues = validateListing(makeListing({
      wav: {
        ...makeListing().wav,
        conversionManufacturer: 'Driverge ConversionRear Entry Manual Fold Out LocationNorth Las Vegas NV',
      },
    }))
    expect(issues.some(i => i.field === 'conversionManufacturer' && i.rule === 'field_label_bleed')).toBe(true)
  })

  it('detects field_label_bleed in city', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'South Salt Lake UT (Salt Lake City)    Stock: TR218378 Request Information', state: null, lat: null, lng: null },
    }))
    expect(issues.some(i => i.field === 'city' && i.rule === 'field_label_bleed')).toBe(true)
  })

  it('detects contains_digits in city', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'North Las Vegas 89030', state: 'NV', lat: null, lng: null },
    }))
    expect(issues.some(i => i.field === 'city' && i.rule === 'contains_digits')).toBe(true)
  })

  it('detects invalid_format for state codes that are not two uppercase letters', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'Londonderry', state: 'New Hampshire', lat: null, lng: null },
    }))
    expect(issues.some(i => i.field === 'state' && i.rule === 'invalid_format')).toBe(true)
  })

  it('does not flag a missing state as invalid_format', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'Londonderry', state: null, lat: null, lng: null },
    }))
    expect(issues.every(i => i.field !== 'state')).toBe(true)
  })
})

// ─── summarizeQuality ─────────────────────────────────────────────────────────

describe('summarizeQuality', () => {
  it('returns zeros for empty results', () => {
    const s = summarizeQuality([])
    expect(s.totalListings).toBe(0)
    expect(s.listingsWithIssues).toBe(0)
  })

  it('counts error and warn listings separately', () => {
    const s = summarizeQuality([
      { sourceRecordKey: 'A', issues: [{ field: 'sourceRecordKey', value: 'A B', rule: 'contains_space', severity: 'error' }] },
      { sourceRecordKey: 'B', issues: [{ field: 'city', value: 'Foo 123', rule: 'contains_digits', severity: 'warn' }] },
      { sourceRecordKey: 'C', issues: [] },
    ])
    expect(s.totalListings).toBe(3)
    expect(s.listingsWithIssues).toBe(2)
    expect(s.errorListings).toBe(1)
    expect(s.warnListings).toBe(1)
    expect(s.issuesByRule['contains_space']).toBe(1)
    expect(s.issuesByRule['contains_digits']).toBe(1)
  })

  it('counts a listing with both error and warn issues in both buckets', () => {
    const s = summarizeQuality([
      {
        sourceRecordKey: 'A',
        issues: [
          { field: 'sourceRecordKey', value: 'A B', rule: 'contains_space', severity: 'error' },
          { field: 'city', value: 'Foo 1', rule: 'contains_digits', severity: 'warn' },
        ],
      },
    ])
    expect(s.errorListings).toBe(1)
    expect(s.warnListings).toBe(1)
  })
})

// ─── SYSTEMIC_ERROR_THRESHOLD ─────────────────────────────────────────────────

describe('SYSTEMIC_ERROR_THRESHOLD', () => {
  it('is 0.2 (20%)', () => {
    expect(SYSTEMIC_ERROR_THRESHOLD).toBe(0.2)
  })
})
