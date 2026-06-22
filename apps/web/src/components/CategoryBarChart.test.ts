import { describe, expect, it } from 'vitest'
import { normalizeFacetsData } from './CategoryBarChart'

describe('normalizeFacetsData', () => {
  it('preserves the legacy wavFeatures shape used by the filter UI', () => {
    expect(normalizeFacetsData({
      conversionBreakdown: [{ value: 'rear_entry', count: 2 }],
      wavFeatures: {
        hasLift: 1,
        handControls: 2,
        rampTypes: [{ value: 'fold_out', count: 3 }],
      },
    })).toMatchObject({
      conversionBreakdown: [{ value: 'rear_entry', count: 2 }],
      wavFeatures: {
        hasLift: 1,
        handControls: 2,
        rampTypes: [{ value: 'fold_out', count: 3 }],
      },
    })
  })

  it('derives lift and hand-control counts from wavFeatureCounts when legacy fields are absent', () => {
    expect(normalizeFacetsData({
      wavFeatureCounts: {
        has_lift: 4,
        hand_controls: 5,
      },
    })).toMatchObject({
      makeBreakdown: [],
      modelBreakdown: [],
      conditionBreakdown: [],
      conversionBreakdown: [],
      colorBreakdown: [],
      stateBreakdown: [],
      wavFeatures: {
        hasLift: 4,
        handControls: 5,
        rampTypes: [],
      },
    })
  })
})
