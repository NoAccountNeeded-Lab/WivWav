import { describe, expect, it } from 'vitest'
import { stageStatus, stageStatusLabel, type PipelineStage } from './source-pipeline-helpers'

function buildStage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    stage: 'detail-crawl',
    queue: 'detail-crawl',
    pendingCount: 0,
    lastCompletedAt: null,
    failedCount: 0,
    failedScopedToSource: true,
    stalled: false,
    ...overrides,
  }
}

describe('stageStatus', () => {
  it('returns "ok" when there is no pending work, no failures, and no stall', () => {
    expect(stageStatus(buildStage())).toBe('ok')
  })

  it('returns "ok" when pending work exists but is progressing normally', () => {
    expect(stageStatus(buildStage({ pendingCount: 5 }))).toBe('ok')
  })

  it('returns "stalled" when pending work exists with no recent completion', () => {
    expect(stageStatus(buildStage({ pendingCount: 5, stalled: true }))).toBe('stalled')
  })

  it('returns "failed" when failed jobs exist, even if also stalled', () => {
    expect(stageStatus(buildStage({ pendingCount: 5, stalled: true, failedCount: 2 }))).toBe('failed')
  })

  it('prioritizes "failed" over "stalled" so the more actionable signal wins', () => {
    const stage = buildStage({ failedCount: 1, stalled: true })
    expect(stageStatus(stage)).toBe('failed')
  })
})

describe('stageStatusLabel', () => {
  it('labels a failing stage distinctly from a stalled one', () => {
    expect(stageStatusLabel(buildStage({ failedCount: 1 }))).toBe('Failing')
    expect(stageStatusLabel(buildStage({ pendingCount: 1, stalled: true }))).toBe('Stalled')
  })

  it('labels an idle stage with no pending work', () => {
    expect(stageStatusLabel(buildStage())).toBe('Idle')
  })

  it('labels a healthy, actively-progressing stage as "In progress"', () => {
    expect(stageStatusLabel(buildStage({ pendingCount: 3 }))).toBe('In progress')
  })
})
