import { describe, it, expect } from 'vitest'
import {
  parseMwRampType,
  parseMwFloorLowering,
  parseMwZip,
  parseMwDetail,
  NON_VEHICLE_PATH_PATTERN,
} from './mobilityworks-detail.js'
import type { RawMwDetail } from './mobilityworks-detail.js'

// ─── parseMwRampType ──────────────────────────────────────────────────────────

describe('parseMwRampType', () => {
  it('detects in-floor ramp', () => {
    expect(parseMwRampType('In-Floor ramp conversion')).toBe('in_floor')
    expect(parseMwRampType('infloor automatic')).toBe('in_floor')
    expect(parseMwRampType('in floor ramp fully operational')).toBe('in_floor')
  })

  it('detects fold-out ramp', () => {
    expect(parseMwRampType('Rear Entry Manual Fold Out')).toBe('fold_out')
    expect(parseMwRampType('fold-out ramp')).toBe('fold_out')
  })

  it('detects fold-in ramp', () => {
    expect(parseMwRampType('Fold In ramp included')).toBe('fold_in')
    expect(parseMwRampType('fold-in ramp')).toBe('fold_in')
  })

  it('returns unknown when no ramp type can be determined', () => {
    expect(parseMwRampType('Wheelchair accessible van')).toBe('unknown')
    expect(parseMwRampType('')).toBe('unknown')
  })
})

// ─── parseMwFloorLowering ─────────────────────────────────────────────────────

describe('parseMwFloorLowering', () => {
  it('parses floor lowering in various formats', () => {
    expect(parseMwFloorLowering('14 inch floor lowering')).toBe(14)
    expect(parseMwFloorLowering('6 in. floor drop')).toBe(6)
    expect(parseMwFloorLowering('floor lowering of 10 inches')).toBe(10)
  })

  it('returns null when not mentioned', () => {
    expect(parseMwFloorLowering('Fold Out ramp conversion')).toBeNull()
    expect(parseMwFloorLowering('')).toBeNull()
  })
})

// ─── parseMwZip ───────────────────────────────────────────────────────────────

describe('parseMwZip', () => {
  it('extracts a 5-digit zip from an address string', () => {
    expect(parseMwZip('1234 Main St, Atlanta, GA 30301')).toBe('30301')
  })

  it('returns null when no zip is present', () => {
    expect(parseMwZip('Atlanta, GA')).toBeNull()
    expect(parseMwZip('')).toBeNull()
  })
})

// ─── NON_VEHICLE_PATH_PATTERN ────────────────────────────────────────────────

describe('NON_VEHICLE_PATH_PATTERN', () => {
  it('rejects social icon paths', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/social/facebook.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('https://static.mw.com/assets/social/instagram.png')).toBe(true)
  })

  it('rejects logo paths', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/logo/mw-logo.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mw.com/brand/logo-white.png')).toBe(true)
  })

  it('rejects badge/financing paths', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/badge/financing-available.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mw.com/promo/financing-badge.png')).toBe(true)
  })

  it('rejects arrow/icon paths from the #506 audit', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/arrow/dropdown-arrow.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/icon/search-icon.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/star/star-filled.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/pin/location-pin.png')).toBe(true)
  })

  it('rejects conversion/NMEDA partner logos', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mw.com/brands/vmi-badge.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('/assets/badge/nmeda-certified.png')).toBe(true)
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mw.com/partners/ally-financial.png')).toBe(true)
  })

  it('does not reject vehicle inventory image paths', () => {
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mobilityworks.com/vehicles/2022-sienna-001-ext.jpg')).toBe(false)
    expect(NON_VEHICLE_PATH_PATTERN.test('https://cdn.mobilityworks.com/inventory/2023-odyssey-003-int.jpg')).toBe(false)
    expect(NON_VEHICLE_PATH_PATTERN.test('/images/van1.jpg')).toBe(false)
  })
})

// ─── parseMwDetail ────────────────────────────────────────────────────────────

const baseRaw: RawMwDetail = {
  specs: {
    'Exterior Color': 'Silver',
    Engine: '3.5L V6',
    'Fuel Type': 'Gasoline',
    Transmission: 'Automatic',
  },
  descriptionText: 'Rear Entry Manual Fold Out ramp. 14 inch floor lowering. Hand controls installed.',
  descriptionFound: true,
  imageUrls: [
    'https://www.mobilityworks.com/images/van1.jpg',
    'https://www.mobilityworks.com/images/van2.jpg',
  ],
  galleryFound: true,
  dealerPhone: '(404) 555-1234',
  dealerAddressText: '1234 Main St Atlanta GA 30301',
  statusBannerText: '',
}

describe('parseMwDetail', () => {
  // ── Field extraction ───────────────────────────────────────────────────────

  it('extracts color from Exterior Color spec', () => {
    expect(parseMwDetail(baseRaw).color).toBe('Silver')
  })

  it('extracts fuelType from Fuel Type spec — NOT from Engine spec', () => {
    const result = parseMwDetail(baseRaw)
    expect(result.fuelType).toBe('Gasoline')
    // Engine text must not end up as fuelType
    expect(result.fuelType).not.toBe('3.5L V6')
  })

  it('extracts transmission from Transmission spec', () => {
    expect(parseMwDetail(baseRaw).transmission).toBe('Automatic')
  })

  it('returns null fuelType when only Engine spec present and no Fuel Type spec', () => {
    const noFuelType = {
      ...baseRaw,
      specs: { Engine: '3.5L V6', Transmission: 'Automatic' },
    }
    expect(parseMwDetail(noFuelType).fuelType).toBeNull()
  })

  // ── Description extraction confidence ──────────────────────────────────────

  it('returns description when descriptionFound is true', () => {
    expect(parseMwDetail(baseRaw).description).toBe(
      'Rear Entry Manual Fold Out ramp. 14 inch floor lowering. Hand controls installed.',
    )
  })

  it('returns null description when descriptionFound is false (extraction failure)', () => {
    const noDesc: RawMwDetail = {
      ...baseRaw,
      descriptionText: 'This is some arbitrary page paragraph that should not be used.',
      descriptionFound: false,
    }
    expect(parseMwDetail(noDesc).description).toBeNull()
  })

  it('returns null description when descriptionFound is true but text is empty (genuinely absent)', () => {
    const emptyDesc: RawMwDetail = {
      ...baseRaw,
      descriptionText: '',
      descriptionFound: true,
    }
    expect(parseMwDetail(emptyDesc).description).toBeNull()
  })

  // ── Gallery extraction confidence ──────────────────────────────────────────

  it('returns images when galleryFound is true', () => {
    expect(parseMwDetail(baseRaw).images).toHaveLength(2)
  })

  it('returns empty images when galleryFound is false (prevents whole-page pollution)', () => {
    const noGallery: RawMwDetail = {
      ...baseRaw,
      imageUrls: [
        'https://www.mobilityworks.com/images/van1.jpg',
        'https://static.mw.com/assets/social/facebook.png',
        'https://cdn.mw.com/promo/financing-badge.png',
      ],
      galleryFound: false,
    }
    expect(parseMwDetail(noGallery).images).toEqual([])
  })

  it('returns empty images when gallery found but imageUrls is empty (valid empty gallery)', () => {
    const emptyGallery: RawMwDetail = {
      ...baseRaw,
      imageUrls: [],
      galleryFound: true,
    }
    expect(parseMwDetail(emptyGallery).images).toEqual([])
  })

  // ── WAV feature extraction from description ──────────────────────────────

  it('parses ramp type from description text', () => {
    expect(parseMwDetail(baseRaw).rampType).toBe('fold_out')
  })

  it('parses floor lowering from description text', () => {
    expect(parseMwDetail(baseRaw).floorLoweringInches).toBe(14)
  })

  it('includes hand_controls in wavFeatures when description mentions hand controls', () => {
    expect(parseMwDetail(baseRaw).wavFeatures).toContain('hand_controls')
  })

  it('includes has_lift in wavFeatures when description mentions a lift', () => {
    const withLift: RawMwDetail = { ...baseRaw, descriptionText: 'Power lift included', descriptionFound: true }
    expect(parseMwDetail(withLift).wavFeatures).toContain('has_lift')
  })

  it('does not include has_lift when description has no lift', () => {
    const withoutLift: RawMwDetail = { ...baseRaw, descriptionText: 'Fold Out ramp', descriptionFound: true }
    expect(parseMwDetail(withoutLift).wavFeatures).not.toContain('has_lift')
  })

  it('includes transfer_seat in wavFeatures when description mentions transfer seat', () => {
    const withSeat: RawMwDetail = { ...baseRaw, descriptionText: 'Transfer seat installed', descriptionFound: true }
    expect(parseMwDetail(withSeat).wavFeatures).toContain('transfer_seat')
  })

  it('returns empty wavFeatures when description extraction failed', () => {
    const failedDesc: RawMwDetail = {
      ...baseRaw,
      descriptionText: 'Flexible financing options subject to credit approval.',
      descriptionFound: false,
    }
    expect(parseMwDetail(failedDesc).wavFeatures).toEqual([])
  })

  it('returns unknown rampType when description extraction failed', () => {
    const failedDesc: RawMwDetail = {
      ...baseRaw,
      descriptionText: 'In-floor ramp! Power ramp! From wrong page section.',
      descriptionFound: false,
    }
    expect(parseMwDetail(failedDesc).rampType).toBe('unknown')
  })

  it('extracts zip from dealer address', () => {
    expect(parseMwDetail(baseRaw).zip).toBe('30301')
  })

  it('passes through dealer phone', () => {
    expect(parseMwDetail(baseRaw).dealerPhone).toBe('(404) 555-1234')
  })

  it('returns active saleStatus when no banner is present', () => {
    expect(parseMwDetail(baseRaw).saleStatus).toBe('active')
  })

  it('returns sold saleStatus when banner says Sold', () => {
    const sold: RawMwDetail = { ...baseRaw, statusBannerText: 'Sold' }
    expect(parseMwDetail(sold).saleStatus).toBe('sold')
  })

  it('returns pending saleStatus when banner says Pending Sale', () => {
    const pending: RawMwDetail = { ...baseRaw, statusBannerText: 'Pending Sale' }
    expect(parseMwDetail(pending).saleStatus).toBe('pending')
  })

  it('falls back to Color spec when Exterior Color is absent', () => {
    const noExtColor: RawMwDetail = {
      ...baseRaw,
      specs: { Color: 'Blue', 'Fuel Type': 'Gasoline', Transmission: 'CVT' },
    }
    expect(parseMwDetail(noExtColor).color).toBe('Blue')
  })

  // ── Idempotent reprocessing ───────────────────────────────────────────────

  it('produces identical output when called twice on the same raw input (idempotent)', () => {
    const first = parseMwDetail(baseRaw)
    const second = parseMwDetail(baseRaw)
    expect(first).toEqual(second)
  })

  // ── Completely sparse / missing fields ───────────────────────────────────

  it('returns null for optional fields when not present', () => {
    const sparse: RawMwDetail = {
      specs: {},
      descriptionText: '',
      descriptionFound: false,
      imageUrls: [],
      galleryFound: false,
      dealerPhone: '',
      dealerAddressText: '',
      statusBannerText: '',
    }
    const result = parseMwDetail(sparse)
    expect(result.color).toBeNull()
    expect(result.fuelType).toBeNull()
    expect(result.transmission).toBeNull()
    expect(result.zip).toBeNull()
    expect(result.dealerPhone).toBeNull()
    expect(result.description).toBeNull()
    expect(result.images).toEqual([])
    expect(result.wavFeatures).toEqual([])
    expect(result.rampType).toBe('unknown')
    expect(result.floorLoweringInches).toBeNull()
  })
})
