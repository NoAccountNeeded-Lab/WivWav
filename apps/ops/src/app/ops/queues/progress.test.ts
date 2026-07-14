import { describe, expect, it } from 'vitest'
import { buildJobProgressModel, buildQueueSnapshotProgress } from './progress.js'

describe('buildQueueSnapshotProgress', () => {
  it('returns count-backed settled progress for visible jobs', () => {
    expect(buildQueueSnapshotProgress({
      waiting: 2,
      active: 1,
      delayed: 1,
      completed: 5,
      failed: 1,
    })).toMatchObject({
      value: 6,
      max: 10,
      pending: 4,
      caption: '6 of 10 visible jobs settled',
    })
  })

  it('returns null when the snapshot has no visible jobs', () => {
    expect(buildQueueSnapshotProgress({
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    })).toBeNull()
  })
})

describe('buildJobProgressModel', () => {
  it('uses determinate progress when the job reports current and total counts', () => {
    expect(buildJobProgressModel({
      id: '42',
      status: 'active',
      progress: { stage: 'fetching', current: 2, total: 5, message: 'Polling upstream' },
    })).toMatchObject({
      kind: 'determinate',
      value: 2,
      max: 5,
      label: 'Job #42 fetching progress',
      caption: '2 of 5 fetching · Polling upstream',
    })
  })

  it('appends success/failed counts to the caption when a job reports them separately (#637)', () => {
    expect(buildJobProgressModel({
      id: '7',
      status: 'failed',
      progress: { stage: 'complete', current: 10, total: 10, success: 7, failed: 3 },
    })).toMatchObject({
      kind: 'determinate',
      caption: '10 of 10 complete (7 succeeded, 3 failed)',
    })
  })

  it('omits the success/failed suffix when only one of the two counts is present', () => {
    expect(buildJobProgressModel({
      id: '7',
      status: 'active',
      progress: { stage: 'extracting', current: 4, total: 10, success: 4 },
    })).toMatchObject({
      caption: '4 of 10 extracting',
    })
  })

  it('falls back to indeterminate status text when active work has no measurable counts', () => {
    expect(buildJobProgressModel({
      id: '42',
      status: 'active',
      progress: 'warming cache',
    })).toEqual({
      kind: 'indeterminate',
      statusText: 'Active job has not reported measurable progress yet.',
    })
  })
})
