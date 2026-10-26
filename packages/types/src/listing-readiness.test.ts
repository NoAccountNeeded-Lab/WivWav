import { describe, expect, it } from 'vitest'
import { computeReadiness, type ListingReadinessInput } from './listing-readiness.js'

const detail = new Date('2026-10-20T00:00:00Z')
const base: ListingReadinessInput & { city: string | null } = {
  detailScrapedAt: detail,
  detailStaleAt: null,
  qualityCheckedAt: detail,
  publicationStatus: 'eligible',
  images: ['https://example.test/van.jpg'],
  vin: null,
  vehicleModelId: null,
  conversionType: 'unknown',
  city: 'Denver',
}

describe('computeReadiness', () => {
  it('accepts the explicit exemptions for no VIN and unknown conversion after detail', () => {
    expect(computeReadiness(base)).toEqual({
      ready: true,
      blockers: [],
      warnings: ['no_vin', 'conversion_type_unknown'],
    })
  })

  it.each([
    ['detail_not_crawled', { detailScrapedAt: null }],
    ['detail_stale', { detailStaleAt: new Date() }],
    ['not_validated_after_detail', { qualityCheckedAt: null }],
    ['no_images', { images: [] }],
    ['vin_not_decoded', { vin: '1HGCM82633A004352' }],
    ['conversion_type_unresolved', { detailScrapedAt: null, conversionType: 'unknown' }],
  ] as const)('reports %s', (blocker, overrides) => {
    const result = computeReadiness({ ...base, ...overrides })
    expect(result.ready).toBe(false)
    expect(result.blockers).toContain(blocker)
  })

  it('warns when city is missing without blocking readiness', () => {
    expect(computeReadiness({ ...base, city: null })).toMatchObject({ ready: true, blockers: [] })
    expect(computeReadiness({ ...base, city: null }).warnings).toContain('no_city')
  })
})
