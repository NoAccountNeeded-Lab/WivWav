import { describe, expect, it, vi } from 'vitest'
import { QUEUES } from '@wivwav/queue'
import type { QueueFactory } from '@wivwav/queue'
import { JobRunReaper } from './job-run-reaper.js'
import type { AbandonableJobRunRepository } from './job-run-repository.js'

function buildRepository() {
  return {
    findRunningBefore: vi.fn(async () => [
      { id: 'gone', jobType: QUEUES.SOURCE_SCRAPE, queueJobId: 'gone-job', startedAt: new Date(0) },
      { id: 'live', jobType: QUEUES.SOURCE_SCRAPE, queueJobId: 'live-job', startedAt: new Date(0) },
      { id: 'expired', jobType: QUEUES.SOURCE_SCRAPE, queueJobId: 'expired-job', startedAt: new Date(0) },
      // startScraperRun rows carry no queue job id and must never be reaped.
      { id: 'untracked', jobType: QUEUES.SOURCE_SCRAPE, queueJobId: null, startedAt: new Date(0) },
    ]),
    abandonIfRunning: vi.fn(async (_id: string) => true),
  } satisfies Pick<AbandonableJobRunRepository, 'findRunningBefore' | 'abandonIfRunning'>
}

function buildFactory(): QueueFactory {
  return {
    createQueue: vi.fn(() => ({
      getJobLiveness: vi.fn(async (jobId: string) => {
        if (jobId === 'live-job') return 'live' as const // BullMQ lock is held.
        if (jobId === 'expired-job') return 'expired' as const
        return 'gone' as const
      }),
    } as never)),
    createWorker: vi.fn(),
    close: vi.fn(async () => {}),
  }
}

describe('JobRunReaper', () => {
  it('reaps gone and expired runs but never reaps a live held-lock job', async () => {
    const repository = buildRepository()
    const reaper = new JobRunReaper(repository, buildFactory(), 60_000)

    await expect(reaper.run(new Date(120_000))).resolves.toEqual({ reapedCount: 2, runningTooLongCount: 2 })
    expect(repository.abandonIfRunning).toHaveBeenCalledWith('gone')
    expect(repository.abandonIfRunning).toHaveBeenCalledWith('expired')
    expect(repository.abandonIfRunning).not.toHaveBeenCalledWith('live')
    expect(repository.abandonIfRunning).not.toHaveBeenCalledWith('untracked')
  })

  it('uses the configured age when selecting candidates', async () => {
    const repository = buildRepository()
    const reaper = new JobRunReaper(repository, buildFactory(), 90_000)

    await reaper.run(new Date(120_000))

    expect(repository.findRunningBefore).toHaveBeenCalledWith(new Date(30_000))
  })
})
