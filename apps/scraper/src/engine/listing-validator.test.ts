import { describe, it, expect } from 'vitest'
import {
  validateListing,
  validateAuthoritativeMismatch,
  decidePublication,
  summarizeQuality,
  detectSourceDrift,
  SYSTEMIC_ERROR_THRESHOLD,
  DRIFT_THRESHOLD_PERCENTAGE_POINTS,
} from './listing-validator.js'
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
    location: { zip: '89030', city: 'North Las Vegas', state: 'NV', lat: null, lng: null },
    dealer: { name: 'MobilityWorks', phone: null, website: 'https://www.mobilityworks.com' },
    images: [],
    description: null,
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    ...overrides,
  }
}

// ─── Structural ────────────────────────────────────────────────────────────

describe('validateListing — structural', () => {
  it('returns no issues for a clean listing', () => {
    expect(validateListing(makeListing())).toHaveLength(0)
  })

  it('returns error when sourceRecordKey contains a space', () => {
    const issues = validateListing(makeListing({
      sourceRecordKey: 'RS205440 Mileage50094 ColorGrey Conv MakeDriverge ConversionRear Entry Manual Fold Out LocationNorth Las Vegas NV (Las Vegas)    Stock: RS205440 Request Information Schedule a Test Drive',
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ field: 'sourceRecordKey', rule: 'contains_space', family: 'structural', severity: 'error' })
  })

  it('detects field_label_bleed in conversionManufacturer', () => {
    const issues = validateListing(makeListing({
      wav: {
        ...makeListing().wav,
        conversionManufacturer: 'Driverge ConversionRear Entry Manual Fold Out LocationNorth Las Vegas NV',
      },
    }))
    expect(issues.some(i => i.field === 'conversionManufacturer' && i.rule === 'field_label_bleed' && i.family === 'structural')).toBe(true)
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
    expect(issues.some(i => i.field === 'city' && i.rule === 'contains_digits' && i.family === 'structural')).toBe(true)
  })
})

// ─── Format / range ──────────────────────────────────────────────────────────

describe('validateListing — format', () => {
  it('detects invalid_format for state codes that are not two uppercase letters', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'Londonderry', state: 'New Hampshire', lat: null, lng: null },
    }))
    expect(issues.some(i => i.field === 'state' && i.rule === 'invalid_format' && i.family === 'format')).toBe(true)
  })

  it('does not flag a missing state as invalid_format', () => {
    const issues = validateListing(makeListing({
      location: { zip: null, city: 'Londonderry', state: null, lat: null, lng: null },
    }))
    expect(issues.every(i => i.field !== 'state')).toBe(true)
  })

  it('detects invalid_format for a malformed ZIP', () => {
    const issues = validateListing(makeListing({
      location: { zip: 'NV890', city: 'Reno', state: 'NV', lat: null, lng: null },
    }))
    expect(issues.some(i => i.field === 'zip' && i.rule === 'invalid_format')).toBe(true)
  })

  it('accepts a valid ZIP+4', () => {
    const issues = validateListing(makeListing({
      location: { zip: '89030-1234', city: 'North Las Vegas', state: 'NV', lat: null, lng: null },
    }))
    expect(issues.every(i => i.field !== 'zip')).toBe(true)
  })

  it('errors on negative priceCents', () => {
    const issues = validateListing(makeListing({ priceCents: -100 }))
    expect(issues.some(i => i.field === 'priceCents' && i.rule === 'negative_value' && i.severity === 'error')).toBe(true)
  })

  it('errors on negative mileage', () => {
    const issues = validateListing(makeListing({ mileage: -1 }))
    expect(issues.some(i => i.field === 'mileage' && i.rule === 'negative_value' && i.severity === 'error')).toBe(true)
  })

  it('flags an unparseable VIN as error', () => {
    const issues = validateListing(makeListing({ vin: 'NOT-A-VIN' }))
    expect(issues.some(i => i.field === 'vin' && i.rule === 'unparseable_vin' && i.severity === 'error')).toBe(true)
  })

  it('flags a structurally-valid VIN that fails the check digit as warn', () => {
    // Same length/charset as a real VIN but check digit (position 9) is wrong.
    const issues = validateListing(makeListing({ vin: '5TDYRKEC0RS205440' }))
    expect(issues.some(i => i.field === 'vin' && i.rule === 'invalid_check_digit' && i.severity === 'warn')).toBe(true)
  })

  it('does not flag a VIN with a valid check digit', () => {
    const issues = validateListing(makeListing({ vin: '5TDYRKEC8RS205440' }))
    expect(issues.every(i => i.field !== 'vin')).toBe(true)
  })

  it('flags a malformed image URL', () => {
    const issues = validateListing(makeListing({ images: ['not-a-url'] }))
    expect(issues.some(i => i.field === 'images' && i.rule === 'invalid_format')).toBe(true)
  })

  it('errors on a malformed sourceUrl', () => {
    const issues = validateListing(makeListing({ sourceUrl: 'not-a-url' }))
    expect(issues.some(i => i.field === 'sourceUrl' && i.rule === 'malformed_source_url' && i.severity === 'error')).toBe(true)
  })
})

// ─── Plausibility ────────────────────────────────────────────────────────────

describe('validateListing — plausibility', () => {
  it('errors on an implausible year (too old)', () => {
    const issues = validateListing(makeListing({ year: 1899 }))
    expect(issues.some(i => i.field === 'year' && i.rule === 'implausible_year' && i.family === 'plausibility' && i.severity === 'error')).toBe(true)
  })

  it('errors on an implausible year (too far in the future)', () => {
    const issues = validateListing(makeListing({ year: new Date().getFullYear() + 10 }))
    expect(issues.some(i => i.field === 'year' && i.rule === 'implausible_year')).toBe(true)
  })

  it('does not flag a price of 0 (price on request) as implausible', () => {
    const issues = validateListing(makeListing({ priceCents: 0, sellerType: 'private' }))
    expect(issues.every(i => i.field !== 'priceCents')).toBe(true)
  })

  it('warns on an implausibly low nonzero price', () => {
    const issues = validateListing(makeListing({ priceCents: 100 }))
    expect(issues.some(i => i.field === 'priceCents' && i.rule === 'implausible_value' && i.severity === 'warn')).toBe(true)
  })

  it('warns on an implausibly high price', () => {
    const issues = validateListing(makeListing({ priceCents: 100_000_000 }))
    expect(issues.some(i => i.field === 'priceCents' && i.rule === 'implausible_value')).toBe(true)
  })

  it('warns on implausible mileage', () => {
    const issues = validateListing(makeListing({ mileage: 1_000_000 }))
    expect(issues.some(i => i.field === 'mileage' && i.rule === 'implausible_value' && i.family === 'plausibility')).toBe(true)
  })

  it('warns on implausible floorLoweringInches', () => {
    const issues = validateListing(makeListing({ wav: { ...makeListing().wav, floorLoweringInches: 30 } }))
    expect(issues.some(i => i.field === 'floorLoweringInches' && i.rule === 'implausible_value')).toBe(true)
  })

  it('warns on implausible wheelchairCapacity', () => {
    const issues = validateListing(makeListing({ wav: { ...makeListing().wav, wheelchairCapacity: 20 } }))
    expect(issues.some(i => i.field === 'wheelchairCapacity' && i.rule === 'implausible_value')).toBe(true)
  })

  it('warns on an implausible image count', () => {
    const images = Array.from({ length: 100 }, (_, i) => `https://example.com/img-${i}.jpg`)
    const issues = validateListing(makeListing({ images }))
    expect(issues.some(i => i.field === 'images' && i.rule === 'implausible_value')).toBe(true)
  })

  it('does not flag a normal listing on any plausibility rule', () => {
    const issues = validateListing(makeListing())
    expect(issues.filter(i => i.family === 'plausibility')).toHaveLength(0)
  })
})

// ─── Completeness ────────────────────────────────────────────────────────────

describe('validateListing — completeness', () => {
  it('errors when make or model is missing', () => {
    const issues = validateListing(makeListing({ make: '' }))
    expect(issues.some(i => i.field === 'make_model' && i.rule === 'missing_identity_field' && i.severity === 'error')).toBe(true)
  })

  it('warns when a dealer listing has no dealer name', () => {
    const issues = validateListing(makeListing({ dealer: { name: null, phone: null, website: null } }))
    expect(issues.some(i => i.field === 'dealer.name' && i.rule === 'missing_required_field' && i.severity === 'warn')).toBe(true)
  })

  it('does not require a dealer name for a private-seller listing', () => {
    const issues = validateListing(makeListing({ sellerType: 'private', dealer: { name: null, phone: null, website: null } }))
    expect(issues.every(i => i.field !== 'dealer.name')).toBe(true)
  })

  it('warns when a used dealer listing has a null price (missing, not price-on-request)', () => {
    const issues = validateListing(makeListing({ priceCents: null, sellerType: 'dealer', condition: 'used' }))
    expect(issues.some(i => i.field === 'priceCents' && i.rule === 'missing_conditional_field' && i.severity === 'warn')).toBe(true)
  })

  it('does not flag a private-seller listing with a null price (legitimate price on request)', () => {
    const issues = validateListing(makeListing({ priceCents: null, sellerType: 'private' }))
    expect(issues.every(i => !(i.field === 'priceCents' && i.rule === 'missing_conditional_field'))).toBe(true)
  })

  it('does not flag a new-condition listing with a null price', () => {
    const issues = validateListing(makeListing({ priceCents: null, condition: 'new', sellerType: 'dealer' }))
    expect(issues.every(i => !(i.field === 'priceCents' && i.rule === 'missing_conditional_field'))).toBe(true)
  })
})

// ─── Cross-field ──────────────────────────────────────────────────────────────

describe('validateListing — cross-field', () => {
  it('warns when saleStatus is sold but soldAt is null', () => {
    const issues = validateListing(makeListing({ saleStatus: 'sold', soldAt: null }))
    expect(issues.some(i => i.rule === 'sold_without_sold_at' && i.family === 'cross_field')).toBe(true)
  })

  it('errors when saleStatus is active but soldAt is set', () => {
    const issues = validateListing(makeListing({ saleStatus: 'active', soldAt: new Date() }))
    expect(issues.some(i => i.rule === 'active_with_sold_at' && i.severity === 'error')).toBe(true)
  })

  it('does not flag a consistent sold listing', () => {
    const issues = validateListing(makeListing({ saleStatus: 'sold', soldAt: new Date() }))
    expect(issues.every(i => i.family !== 'cross_field' || i.rule !== 'sold_without_sold_at')).toBe(true)
  })

  it('warns when condition is new but mileage is high', () => {
    const issues = validateListing(makeListing({ condition: 'new', mileage: 5000 }))
    expect(issues.some(i => i.rule === 'new_with_high_mileage')).toBe(true)
  })

  it('warns when an accessibility feature is claimed with no corroborating evidence', () => {
    const issues = validateListing(makeListing({
      wav: {
        conversionType: 'unknown',
        conversionManufacturer: null,
        floorLoweringInches: null,
        rampType: 'unknown',
        conversionStatus: 'unknown',
        wavFeatures: ['has_lift'],
        wheelchairCapacity: null,
      },
    }))
    expect(issues.some(i => i.rule === 'unsupported_accessibility_claim' && i.family === 'cross_field')).toBe(true)
  })

  it('does not flag an accessibility feature when corroborating evidence exists', () => {
    const issues = validateListing(makeListing({
      wav: {
        conversionType: 'rear_entry',
        conversionManufacturer: null,
        floorLoweringInches: null,
        rampType: 'fold_out',
        conversionStatus: 'unknown',
        wavFeatures: ['has_lift'],
        wheelchairCapacity: null,
      },
    }))
    expect(issues.every(i => i.rule !== 'unsupported_accessibility_claim')).toBe(true)
  })
})

// ─── Authoritative mismatch (NHTSA) ─────────────────────────────────────────

describe('validateAuthoritativeMismatch', () => {
  it('returns no issues when scraped identity matches the NHTSA decode', () => {
    const issues = validateAuthoritativeMismatch(
      { make: 'Toyota', model: 'Sienna', year: 2024 },
      { make: 'Toyota', model: 'Sienna', year: 2024 },
    )
    expect(issues).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const issues = validateAuthoritativeMismatch(
      { make: 'TOYOTA', model: 'sienna', year: 2024 },
      { make: 'Toyota', model: 'Sienna', year: 2024 },
    )
    expect(issues).toHaveLength(0)
  })

  it('tolerates a 1-year model-year skew', () => {
    const issues = validateAuthoritativeMismatch(
      { make: 'Toyota', model: 'Sienna', year: 2023 },
      { make: 'Toyota', model: 'Sienna', year: 2024 },
    )
    expect(issues).toHaveLength(0)
  })

  it('flags a make mismatch as an authoritative error', () => {
    const issues = validateAuthoritativeMismatch(
      { make: 'Toyota', model: 'Sienna', year: 2024 },
      { make: 'Honda', model: 'Odyssey', year: 2024 },
    )
    expect(issues.some(i => i.rule === 'nhtsa_make_mismatch' && i.family === 'authoritative' && i.severity === 'error')).toBe(true)
    expect(issues.some(i => i.rule === 'nhtsa_model_mismatch' && i.severity === 'error')).toBe(true)
  })

  it('flags a year mismatch beyond the tolerance', () => {
    const issues = validateAuthoritativeMismatch(
      { make: 'Toyota', model: 'Sienna', year: 2018 },
      { make: 'Toyota', model: 'Sienna', year: 2024 },
    )
    expect(issues.some(i => i.rule === 'nhtsa_year_mismatch' && i.severity === 'error')).toBe(true)
  })
})

// ─── decidePublication ────────────────────────────────────────────────────────

describe('decidePublication', () => {
  it('publishes a listing with no issues', () => {
    expect(decidePublication([])).toEqual({ publicationStatus: 'eligible', qualityIssueCodes: [] })
  })

  it('quarantines a listing with any error-severity issue', () => {
    const result = decidePublication([
      { field: 'sourceRecordKey', value: 'a b', rule: 'contains_space', family: 'structural', severity: 'error' },
    ])
    expect(result.publicationStatus).toBe('quarantined')
    expect(result.qualityIssueCodes).toEqual(['contains_space'])
  })

  it('publishes a listing with only warn-severity issues', () => {
    const result = decidePublication([
      { field: 'city', value: 'Foo 1', rule: 'contains_digits', family: 'structural', severity: 'warn' },
    ])
    expect(result.publicationStatus).toBe('eligible')
    expect(result.qualityIssueCodes).toEqual(['contains_digits'])
  })

  it('quarantines when both error and warn issues are present', () => {
    const result = decidePublication([
      { field: 'city', value: 'Foo 1', rule: 'contains_digits', family: 'structural', severity: 'warn' },
      { field: 'year', value: '1899', rule: 'implausible_value', family: 'plausibility', severity: 'error' },
    ])
    expect(result.publicationStatus).toBe('quarantined')
  })

  it('deduplicates repeated rule codes', () => {
    const result = decidePublication([
      { field: 'images', value: 'a', rule: 'invalid_format', family: 'format', severity: 'warn' },
      { field: 'images', value: 'b', rule: 'invalid_format', family: 'format', severity: 'warn' },
    ])
    expect(result.qualityIssueCodes).toEqual(['invalid_format'])
  })

  it('quarantines an unsupported accessibility claim despite being warn-severity', () => {
    // unsupported_accessibility_claim is a documented field-specific blocking warning:
    // an accessibility badge with zero corroborating evidence would materially
    // mislead a wheelchair user, so it blocks publication even though the rule
    // itself is severity 'warn' (not 'error').
    const result = decidePublication([
      { field: 'wavFeatures', value: 'has_lift', rule: 'unsupported_accessibility_claim', family: 'cross_field', severity: 'warn' },
    ])
    expect(result.publicationStatus).toBe('quarantined')
    expect(result.qualityIssueCodes).toEqual(['unsupported_accessibility_claim'])
  })

  it('still publishes other warn-severity issues that are not in the blocking set', () => {
    const result = decidePublication([
      { field: 'state', value: 'New Hampshire', rule: 'invalid_format', family: 'format', severity: 'warn' },
    ])
    expect(result.publicationStatus).toBe('eligible')
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
      { sourceRecordKey: 'A', issues: [{ field: 'sourceRecordKey', value: 'A B', rule: 'contains_space', family: 'structural', severity: 'error' }] },
      { sourceRecordKey: 'B', issues: [{ field: 'city', value: 'Foo 123', rule: 'contains_digits', family: 'structural', severity: 'warn' }] },
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
          { field: 'sourceRecordKey', value: 'A B', rule: 'contains_space', family: 'structural', severity: 'error' },
          { field: 'city', value: 'Foo 1', rule: 'contains_digits', family: 'structural', severity: 'warn' },
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

// ─── Source drift baseline ────────────────────────────────────────────────────

describe('detectSourceDrift', () => {
  it('does not flag drift when the observation is within tolerance of the baseline', () => {
    const result = detectSourceDrift(
      { baselineErrorRate: 0.05, baselineMissingRate: 0.05 },
      { errorRate: 0.1, missingRate: 0.1 },
    )
    expect(result.drifted).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('flags abrupt drift when the error rate jumps well above baseline', () => {
    const result = detectSourceDrift(
      { baselineErrorRate: 0.02, baselineMissingRate: 0.02 },
      { errorRate: 0.5, missingRate: 0.02 },
    )
    expect(result.drifted).toBe(true)
    expect(result.reason).toContain('error rate')
  })

  it('flags abrupt drift when the missing rate jumps well above baseline', () => {
    const result = detectSourceDrift(
      { baselineErrorRate: 0.02, baselineMissingRate: 0.02 },
      { errorRate: 0.02, missingRate: 0.5 },
    )
    expect(result.drifted).toBe(true)
    expect(result.reason).toContain('missing rate')
  })

  it('updates the baseline toward the new observation even when not drifted', () => {
    const result = detectSourceDrift(
      { baselineErrorRate: 0.1, baselineMissingRate: 0.1 },
      { errorRate: 0.15, missingRate: 0.05 },
    )
    expect(result.nextBaseline.baselineErrorRate).toBeGreaterThan(0.1)
    expect(result.nextBaseline.baselineMissingRate).toBeLessThan(0.1)
  })

  it('updates the baseline even when drift is detected, so the pause is informative not permanent', () => {
    const result = detectSourceDrift(
      { baselineErrorRate: 0.02, baselineMissingRate: 0.02 },
      { errorRate: 0.5, missingRate: 0.02 },
    )
    expect(result.nextBaseline.baselineErrorRate).toBeGreaterThan(0.02)
  })

  it('never flags drift on a source with no prior baseline (cold start)', () => {
    // A brand-new or freshly-reset source has no rolling history yet.
    // Comparing its first-ever observation against an implicit 0% baseline
    // would flag any nonzero missing/error rate as "abrupt drift" and pause
    // the source before it ever gets a chance to establish a real baseline.
    const result = detectSourceDrift(null, { errorRate: 0.1, missingRate: 0.63 })
    expect(result.drifted).toBe(false)
    expect(result.reason).toBeNull()
    expect(result.nextBaseline).toEqual({ baselineErrorRate: 0.1, baselineMissingRate: 0.63 })
  })

  it('exposes the configured threshold', () => {
    expect(DRIFT_THRESHOLD_PERCENTAGE_POINTS).toBe(0.15)
  })
})
