import { describe, expect, it, vi } from 'vitest'
import type { JobContext } from '@wivwav/queue'
import type { JobRunRepository } from './job-run-repository.js'
import { withJobRunTracking } from './job-run-tracking.js'

function makeContext(): JobContext {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  }
}

function makeJobRuns(startId = 'run-1'): JobRunRepository {
  return {
    start: vi.fn().mockResolvedValue({ id: startId }),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
}

describe('withJobRunTracking', () => {
  it('starts a run with the job type before invoking the processor', async () => {
    const jobRuns = makeJobRuns()
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('geocode', jobRuns, processor)

    await wrapped({}, makeContext())

    expect(jobRuns.start).toHaveBeenCalledWith({ jobType: 'geocode', sourceId: null, parentRunId: null })
  })

  it('reads sourceId off the job data when present', async () => {
    const jobRuns = makeJobRuns()
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('source-scrape', jobRuns, processor)

    await wrapped({ sourceId: 'src-1' }, makeContext())

    expect(jobRuns.start).toHaveBeenCalledWith({
      jobType: 'source-scrape',
      sourceId: 'src-1',
      parentRunId: null,
    })
  })

  it('reads parentRunId off the job data when present', async () => {
    const jobRuns = makeJobRuns()
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('listing-resolve', jobRuns, processor)

    await wrapped({ listingId: 'l-1', parentRunId: 'parent-run' }, makeContext())

    expect(jobRuns.start).toHaveBeenCalledWith({
      jobType: 'listing-resolve',
      sourceId: null,
      parentRunId: 'parent-run',
    })
  })

  it('ignores non-string sourceId/parentRunId values', async () => {
    const jobRuns = makeJobRuns()
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('vin-enrich', jobRuns, processor)

    await wrapped({ sourceId: 42, parentRunId: {} }, makeContext())

    expect(jobRuns.start).toHaveBeenCalledWith({ jobType: 'vin-enrich', sourceId: null, parentRunId: null })
  })

  it('passes the created run id to the processor as context.runId', async () => {
    const jobRuns = makeJobRuns('run-abc')
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('deduplicate', jobRuns, processor)
    const ctx = makeContext()

    await wrapped({}, ctx)

    expect(processor).toHaveBeenCalledWith({}, expect.objectContaining({ ...ctx, runId: 'run-abc' }))
  })

  it('marks the run succeeded when the processor resolves', async () => {
    const jobRuns = makeJobRuns('run-1')
    const processor = vi.fn().mockResolvedValue(undefined)
    const wrapped = withJobRunTracking('listing-sync', jobRuns, processor)

    await wrapped({}, makeContext())

    expect(jobRuns.succeed).toHaveBeenCalledWith('run-1')
    expect(jobRuns.fail).not.toHaveBeenCalled()
  })

  it('marks the run failed and rethrows when the processor throws', async () => {
    const jobRuns = makeJobRuns('run-1')
    const error = new Error('boom')
    const processor = vi.fn().mockRejectedValue(error)
    const wrapped = withJobRunTracking('nhtsa-recalls', jobRuns, processor)

    await expect(wrapped({}, makeContext())).rejects.toThrow('boom')

    expect(jobRuns.fail).toHaveBeenCalledWith('run-1', 'boom')
    expect(jobRuns.succeed).not.toHaveBeenCalled()
  })

  it('still rethrows the original error even if recording the failure itself throws', async () => {
    const jobRuns = makeJobRuns('run-1')
    ;(jobRuns.fail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db unavailable'))
    const error = new Error('processor failed')
    const processor = vi.fn().mockRejectedValue(error)
    const wrapped = withJobRunTracking('nhtsa-complaints', jobRuns, processor)

    const rejected = await wrapped({}, makeContext()).catch((e: unknown) => e)
    expect(rejected).toBe(error)
  })
})
