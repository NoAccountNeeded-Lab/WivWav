import { describe, expect, it } from 'vitest'
import { computeReadiness, isPublishGateStrict, strictReadyWhere, type ListingReadinessInput } from './listing-readiness.js'

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
  it('accepts the explicit no-VIN exemption after detail', () => {
    expect(computeReadiness({ ...base, conversionType: 'rear_entry' })).toEqual({
      ready: true,
      blockers: [],
      warnings: ['no_vin'],
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
    expect(computeReadiness({ ...base, conversionType: 'rear_entry', city: null })).toMatchObject({ ready: true, blockers: [] })
    expect(computeReadiness({ ...base, conversionType: 'rear_entry', city: null }).warnings).toContain('no_city')
  })

  it('blocks unresolved conversion type even when detail is current', () => {
    expect(computeReadiness({ ...base, conversionType: 'unknown' }).blockers).toContain('conversion_type_unresolved')
  })

  it('requires a computed readiness timestamp and eligible status in the strict predicate', () => {
    expect(isPublishGateStrict({ PUBLISH_GATE_STRICT: 'false' })).toBe(false)
    expect(strictReadyWhere({ PUBLISH_GATE_STRICT: 'false' })).toEqual({})
    expect(isPublishGateStrict({ PUBLISH_GATE_STRICT: 'true' })).toBe(true)
    const where = strictReadyWhere({ PUBLISH_GATE_STRICT: 'true' })
    expect(where).toMatchObject({
      qualityCheckedAt: { not: null },
      readinessComputedAt: { not: null },
      readinessBlockers: { isEmpty: true },
    })
  })

  it('reports non-eligible publication status as a readiness blocker', () => {
    expect(computeReadiness({ ...base, publicationStatus: 'quarantined' }).blockers).toContain('not_validated_after_detail')
  })
})
