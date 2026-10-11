import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES, getQueuePolicy } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

describe('GET /listing-refresh/status', () => {
  it('returns source, listing, scrape, and queue readiness data', async () => {
    const now = new Date('2026-06-18T10:00:00Z')
    const source = {
      id: 'src-1',
      name: 'BLVD.com',
      baseUrl: 'https://example.com',
      status: 'active',
      cronExpression: '0 */6 * * *',
      lastScrapedAt: now,
      listingCount: 12,
      errorMessage: null,
    }
    const run = {
      id: 'run-1',
      sourceId: 'src-1',
      startedAt: now,
      finishedAt: now,
      success: true,
      listingsFound: 12,
      listingsNew: 3,
      listingsUpdated: 9,
      errorMessage: null,
    }
    const factory = new MockQueueFactory()
    await factory.createQueue(QUEUES.GEOCODE).add({})
    const { app } = buildTestApp(
      {
        findAll: vi.fn(async () => [source]),
        findManyByIds: vi.fn(async () => [{ id: 'src-1', name: 'BLVD.com' }]),
      },
      { findRecent: vi.fn(async () => [run]) },
      factory,
      {
        countObservedActive: vi.fn(async () => 10),
        countActive: vi.fn(async () => 3),
        countActiveWithCoordinates: vi.fn(async () => 7),
        countActiveMissingCoordinates: vi.fn(async () => 3),
        getPublicationCountsBySource: vi.fn(async () => [{
          sourceId: 'src-1',
          observedActive: 10,
          eligibleActive: 3,
        }]),
      },
    )

    const res = await app.inject({ method: 'GET', url: '/listing-refresh/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      sources: {
        total: 1,
        active: 1,
        needsAttention: 0,
        totalListings: 12,
        observedActiveListings: 10,
        eligibleListings: 3,
        lastScrapedAt: now.toISOString(),
      },
      listings: {
        active: 10,
        observedActive: 10,
        eligible: 3,
        mapReady: 7,
        missingLocations: 3,
      },
      latestScrapeRun: { id: 'run-1', sourceName: 'BLVD.com', listingsNew: 3 },
      queues: expect.arrayContaining([
        expect.objectContaining({
          name: QUEUES.GEOCODE,
          paused: false,
          stats: expect.objectContaining({ waiting: 1 }),
          lastStatus: 'waiting',
        }),
      ]),
    })

    await app.close()
  })

  it('returns 503 when a workflow dependency is unavailable', async () => {
    const factory = {
      createQueue: () => ({
        name: QUEUES.SOURCE_SCRAPE,
        getPolicy: vi.fn(() => getQueuePolicy(QUEUES.SOURCE_SCRAPE)),
        isPaused: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        getStats: vi.fn(),
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobs: vi.fn(),
        getRepeatableJobs: vi.fn(),
        addRepeatable: vi.fn(),
        removeRepeatableByKey: vi.fn(),
        close: vi.fn(),
      }),
      createWorker: vi.fn(),
      close: vi.fn(),
    }
    const { app } = buildTestApp({}, {}, factory as never)

    const res = await app.inject({ method: 'GET', url: '/listing-refresh/status' })

    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Listing refresh status is unavailable' } })

    await app.close()
  })
})
