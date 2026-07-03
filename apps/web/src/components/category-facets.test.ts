import { describe, expect, it } from 'vitest'
import { normalizeFacetsData } from './category-facets'

describe('normalizeFacetsData', () => {
  it('normalizes the current API facet shape', () => {
    const result = normalizeFacetsData({
      makeBreakdown: [{ value: 'Toyota', count: 3 }],
      rampTypeBreakdown: [{ value: 'in_floor', count: 2 }],
      wavFeatureCounts: { has_lift: 4, hand_controls: 1 },
    })

    expect(result.makeBreakdown).toEqual([{ value: 'Toyota', count: 3 }])
    expect(result.wavFeatures).toEqual({
      hasLift: 4,
      handControls: 1,
      rampTypes: [{ value: 'in_floor', count: 2 }],
    })
  })

  it('keeps legacy nested wav feature data working', () => {
    const result = normalizeFacetsData({
      wavFeatures: {
        hasLift: 5,
        handControls: 2,
        rampTypes: [{ value: 'fold_out', count: 3 }],
      },
    })

    expect(result.wavFeatures).toEqual({
      hasLift: 5,
      handControls: 2,
      rampTypes: [{ value: 'fold_out', count: 3 }],
    })
  })

  it('falls back to safe empty values for partial responses', () => {
    const result = normalizeFacetsData({
      wavFeatureCounts: { has_lift: 2 },
    })

    expect(result.conversionBreakdown).toEqual([])
    expect(result.sellerTypeBreakdown).toEqual([])
    expect(result.wavFeatures).toEqual({
      hasLift: 2,
      handControls: 0,
      rampTypes: [],
    })
  })

  it('normalizes conversionBrand breakdown and defaults it to empty', () => {
    const result = normalizeFacetsData({
      conversionBrandBreakdown: [{ value: 'braunability', count: 7 }, { value: 'ams-vans', count: 2 }],
    })

    expect(result.conversionBrandBreakdown).toEqual([
      { value: 'braunability', count: 7 },
      { value: 'ams-vans', count: 2 },
    ])
    expect(normalizeFacetsData({}).conversionBrandBreakdown).toEqual([])
  })

  it('normalizes sellerType breakdown', () => {
    const result = normalizeFacetsData({
      sellerTypeBreakdown: [{ value: 'dealer', count: 4 }, { value: 'private', count: 2 }],
    })

    expect(result.sellerTypeBreakdown).toEqual([
      { value: 'dealer', count: 4 },
      { value: 'private', count: 2 },
    ])
  })

  it('normalizes trim breakdown and defaults it to empty', () => {
    const result = normalizeFacetsData({
      trimBreakdown: [{ value: 'LX', count: 5 }, { value: 'EX', count: 3 }],
    })

    expect(result.trimBreakdown).toEqual([
      { value: 'LX', count: 5 },
      { value: 'EX', count: 3 },
    ])
    expect(normalizeFacetsData({}).trimBreakdown).toEqual([])
  })
})
