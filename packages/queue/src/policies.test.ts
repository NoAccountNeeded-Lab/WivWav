import { describe, expect, it } from 'vitest'
import { QUEUES } from './queues.js'
import { getQueuePolicy } from './policies.js'

describe('getQueuePolicy', () => {
  it('returns per-queue concurrency and retention for source scrape', () => {
    expect(getQueuePolicy(QUEUES.SOURCE_SCRAPE)).toEqual({
      concurrency: 1,
      retention: {
        completed: 50,
        failed: 200,
      },
    })
  })

  it('returns per-queue concurrency and retention for detail extract', () => {
    expect(getQueuePolicy(QUEUES.DETAIL_EXTRACT)).toEqual({
      concurrency: 2,
      retention: {
        completed: 100,
        failed: 300,
      },
    })
  })
})
