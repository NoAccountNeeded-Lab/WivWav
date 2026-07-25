import { describe, expect, it } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import { latestCompletedTimestampSeconds } from './queue-job-timestamps.js'

describe('latestCompletedTimestampSeconds', () => {
  it('returns null when the queue has no completed jobs', async () => {
    const queueFactory = new MockQueueFactory()
    const result = await latestCompletedTimestampSeconds(queueFactory, QUEUES.LISTING_SYNC)
    expect(result).toBeNull()
  })

  it('returns the seconds timestamp of the most recently completed job', async () => {
    const queueFactory = {
      createQueue: () => ({
        getJobs: async () => [
          { id: '1', finishedAt: new Date('2026-06-01T00:00:00Z') },
          { id: '2', finishedAt: new Date('2026-06-18T12:00:00Z') },
        ],
      }),
    }
    const result = await latestCompletedTimestampSeconds(queueFactory as never, QUEUES.LISTING_SYNC)
    expect(result).toBe(1781784000)
  })
})
