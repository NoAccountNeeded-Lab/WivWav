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
    expect(result.wavFeatures).toEqual({
      hasLift: 2,
      handControls: 0,
      rampTypes: [],
    })
  })
})
