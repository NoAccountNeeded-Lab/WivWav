import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

describe('POST /sync', () => {
  it('enqueues the full-rebuild job on the listing-sync queue with a fixed jobId', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'POST', url: '/sync' })
    expect(res.statusCode).toBe(202)
    expect(res.json().data.enqueued).toBe(true)

    const listingSyncQueue = factory.getQueue(QUEUES.LISTING_SYNC)
    const jobs = listingSyncQueue?.getEnqueued() ?? []
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ data: {}, status: 'waiting' })
    expect(jobs[0]?.options).toMatchObject({ jobId: 'listing-sync-rebuild' })

    await app.close()
  })
})

describe('POST /readiness-backfill', () => {
  it('enqueues the backfill on the listing-resolve queue with its fixed job ID', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const response = await app.inject({ method: 'POST', url: '/readiness-backfill' })
    expect(response.statusCode).toBe(202)
    expect(response.json().data.enqueued).toBe(true)

    const jobs = factory.getQueue(QUEUES.LISTING_RESOLVE)?.getEnqueued() ?? []
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ data: { readinessBackfill: true }, status: 'waiting' })
    expect(jobs[0]?.options).toMatchObject({ jobId: 'readiness-backfill', removeOnComplete: true, removeOnFail: true })

    await app.close()
  })
})

describe('GET /sync', () => {
  it('returns lastSyncCompletedAt=null when no listing-sync job has completed', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/sync' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { lastSyncCompletedAt: null } })

    await app.close()
  })

  it('returns the ISO timestamp of the most recently completed listing-sync job', async () => {
    const completedJobs = [
      { id: '1', finishedAt: new Date('2026-06-01T00:00:00Z') },
      { id: '2', finishedAt: new Date('2026-06-18T12:00:00Z') },
    ]
    const factory = {
      createQueue: vi.fn(() => ({ getJobs: vi.fn(async () => completedJobs) })),
      createWorker: vi.fn(),
      close: vi.fn(),
    }
    const { app } = buildTestApp({}, {}, factory as never)

    const res = await app.inject({ method: 'GET', url: '/sync' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { lastSyncCompletedAt: '2026-06-18T12:00:00.000Z' } })

    await app.close()
  })

  it('returns 503 with error envelope when the listing-sync queue is unreachable', async () => {
    const factory = {
      createQueue: vi.fn(() => ({
        getJobs: vi.fn(async () => {
          throw new Error('queue unavailable')
        }),
      })),
      createWorker: vi.fn(),
      close: vi.fn(),
    }
    const { app } = buildTestApp({}, {}, factory as never)

    const res = await app.inject({ method: 'GET', url: '/sync' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'listing-sync queue is unavailable' } })

    await app.close()
  })
})
