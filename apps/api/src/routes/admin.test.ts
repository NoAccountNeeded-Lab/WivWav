import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { adminRoutes } from './admin.js'

const mockSearch = { syncAll: vi.fn(async () => 42) }

function buildDefaultListingRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(async () => null),
    findByIdForSafety: vi.fn(async () => null),
    findVehicleModelWithSafetyData: vi.fn(async () => null),
    findManyActive: vi.fn(async () => []),
    countActive: vi.fn(async () => 0),
    countActiveWithCoordinates: vi.fn(async () => 0),
    countActiveMissingCoordinates: vi.fn(async () => 0),
    findPriceHistory: vi.fn(async () => []),
    findPageForSync: vi.fn(async () => []),
    ...overrides,
  }
}

function buildDefaultSourceRepo(overrides: Record<string, unknown> = {}) {
  return {
    count: vi.fn(async () => 0),
    countActive: vi.fn(async () => 0),
    findAll: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findManyByIds: vi.fn(async () => []),
    findScheduledSources: vi.fn(async () => []),
    ...overrides,
  }
}

function buildDefaultScraperRunRepo(overrides: Record<string, unknown> = {}) {
  return {
    findRecent: vi.fn(async () => []),
    findLastSuccessful: vi.fn(async () => null),
    ...overrides,
  }
}

function buildTestApp(
  sourceRepoOverrides: Record<string, unknown> = {},
  scraperRunRepoOverrides: Record<string, unknown> = {},
  factory: MockQueueFactory,
  search = mockSearch,
  listingRepoOverrides: Record<string, unknown> = {},
) {
  const app = Fastify()
  void app.register(sensible)
  const listings = buildDefaultListingRepo(listingRepoOverrides)
  const sources = buildDefaultSourceRepo(sourceRepoOverrides)
  const scraperRuns = buildDefaultScraperRunRepo(scraperRunRepoOverrides)
  void app.register(adminRoutes, { listings: listings as never, sources: sources as never, scraperRuns: scraperRuns as never, queueFactory: factory as never, search: search as never })
  return { app, listings, sources, scraperRuns }
}

describe('GET /queues', () => {
  it('returns all queue names with stats', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'GET', url: '/queues' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.data)).toBe(true)
    const names = body.data.map((q: { name: string }) => q.name)
    expect(names).toContain(QUEUES.SOURCE_SCRAPE)
    expect(body.data[0]).toMatchObject({ name: expect.any(String), paused: false, stats: expect.any(Object) })
    await app.close()
  })

  it('returns 503 with error envelope when queue service throws', async () => {
    const factory = {
      createQueue: () => ({
        name: QUEUES.SOURCE_SCRAPE,
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
    const res = await app.inject({ method: 'GET', url: '/queues' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Queue service is unavailable' } })
    await app.close()
  })
})

describe('GET /queues/:name', () => {
  it('returns stats and jobs for a known queue', async () => {
    const factory = new MockQueueFactory()
    factory.createQueue(QUEUES.SOURCE_SCRAPE)
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'GET', url: `/queues/${QUEUES.SOURCE_SCRAPE}` })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.name).toBe(QUEUES.SOURCE_SCRAPE)
    expect(data.stats).toMatchObject({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })
    expect(Array.isArray(data.jobs)).toBe(true)
    await app.close()
  })

  it('returns 404 for an unknown queue name', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'GET', url: '/queues/nonexistent' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /queues/:name/jobs', () => {
  it('enqueues a job and returns its id', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({
      method: 'POST',
      url: `/queues/${QUEUES.SOURCE_SCRAPE}/jobs`,
      payload: { data: { sourceId: 'src-1' } },
    })
    expect(res.statusCode).toBe(201)
    const { data } = res.json()
    expect(typeof data.id).toBe('string')
    expect(data.id.length).toBeGreaterThan(0)

    const q = factory.getQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter
    expect(q.getEnqueued()).toHaveLength(1)
    const jobData = q.getEnqueued()[0]!.data as Record<string, unknown>
    expect(jobData['sourceId']).toBe('src-1')
    expect(typeof jobData['traceId']).toBe('string')

    await app.close()
  })

  it('enqueues with empty data when body is omitted', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'POST', url: `/queues/${QUEUES.GEOCODE}/jobs` })
    expect(res.statusCode).toBe(201)

    const q = factory.getQueue(QUEUES.GEOCODE) as MockQueueAdapter
    expect(q.getEnqueued()).toHaveLength(1)

    await app.close()
  })

  it('rejects non-object job data', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({
      method: 'POST',
      url: `/queues/${QUEUES.SOURCE_SCRAPE}/jobs`,
      payload: { data: 'src-1' },
    })

    expect(res.statusCode).toBe(400)
    expect(factory.getQueue(QUEUES.SOURCE_SCRAPE)?.getEnqueued()).toHaveLength(0)

    await app.close()
  })

  it('strips unknown top-level job body fields', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({
      method: 'POST',
      url: `/queues/${QUEUES.SOURCE_SCRAPE}/jobs`,
      payload: { sourceId: 'src-1' },
    })

    expect(res.statusCode).toBe(201)
    const stripped = factory.getQueue(QUEUES.SOURCE_SCRAPE)?.getEnqueued()[0]!.data as Record<string, unknown>
    expect(stripped['sourceId']).toBeUndefined()
    expect(typeof stripped['traceId']).toBe('string')

    await app.close()
  })
})

describe('POST /queues/:name/pause and /resume', () => {
  it('pauses and resumes a queue', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const pauseRes = await app.inject({ method: 'POST', url: `/queues/${QUEUES.SOURCE_SCRAPE}/pause` })
    expect(pauseRes.statusCode).toBe(200)
    expect(pauseRes.json().data.paused).toBe(true)

    const q = factory.getQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter
    expect(await q.isPaused()).toBe(true)

    const resumeRes = await app.inject({ method: 'POST', url: `/queues/${QUEUES.SOURCE_SCRAPE}/resume` })
    expect(resumeRes.statusCode).toBe(200)
    expect(resumeRes.json().data.paused).toBe(false)

    expect(await q.isPaused()).toBe(false)

    await app.close()
  })
})

describe('GET /runs', () => {
  it('returns recent scraper runs from repository', async () => {
    const run = { id: 'run-1', sourceId: 'src-1', startedAt: new Date(), finishedAt: null, success: null, listingsFound: null, listingsNew: null, listingsUpdated: null, errorMessage: null }
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findManyByIds: vi.fn(async () => []) },
      { findRecent: vi.fn(async () => [run]) },
      factory,
    )

    const res = await app.inject({ method: 'GET', url: '/runs' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].id).toBe('run-1')
    expect(res.json().data[0].sourceName).toBeNull()

    await app.close()
  })

  it('includes sourceName when a matching source exists', async () => {
    const run = { id: 'run-1', sourceId: 'src-1', startedAt: new Date(), finishedAt: null, success: null, listingsFound: null, listingsNew: null, listingsUpdated: null, errorMessage: null }
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findManyByIds: vi.fn(async () => [{ id: 'src-1', name: 'BLVD.com' }]) },
      { findRecent: vi.fn(async () => [run]) },
      factory,
    )

    const res = await app.inject({ method: 'GET', url: '/runs' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].sourceName).toBe('BLVD.com')

    await app.close()
  })
})

describe('POST /sources/:id/run', () => {
  it('enqueues a source-scrape job when source exists', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Test Source' })) },
      {},
      factory,
    )

    const res = await app.inject({ method: 'POST', url: '/sources/src-1/run' })
    expect(res.statusCode).toBe(201)
    expect(typeof res.json().data.id).toBe('string')

    const q = factory.getQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter
    expect(q.getEnqueued()).toHaveLength(1)
    const jobData = q.getEnqueued()[0]!.data as Record<string, unknown>
    expect(jobData['sourceId']).toBe('src-1')
    expect(typeof jobData['traceId']).toBe('string')

    await app.close()
  })

  it('returns 404 when source does not exist', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'POST', url: '/sources/nonexistent/run' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /sources', () => {
  it('returns source rows', async () => {
    const source = { id: 'src-1', name: 'test-source', baseUrl: 'https://example.com', status: 'active', cronExpression: '0 * * * *', lastScrapedAt: null, listingCount: 0, errorMessage: null }
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findAll: vi.fn(async () => [source]) },
      {},
      factory,
    )

    const res = await app.inject({ method: 'GET', url: '/sources' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].name).toBe('test-source')

    await app.close()
  })
})

describe('POST /sync', () => {
  it('re-indexes all listings and returns the count', async () => {
    const search = { syncAll: vi.fn(async () => 7) }
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory, search)

    const res = await app.inject({ method: 'POST', url: '/sync' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ synced: 7 })
    expect(search.syncAll).toHaveBeenCalledOnce()

    await app.close()
  })
})

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
      mockSearch,
      {
        countActive: vi.fn(async () => 10),
        countActiveWithCoordinates: vi.fn(async () => 7),
        countActiveMissingCoordinates: vi.fn(async () => 3),
      },
    )

    const res = await app.inject({ method: 'GET', url: '/listing-refresh/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      sources: { total: 1, active: 1, needsAttention: 0, totalListings: 12, lastScrapedAt: now.toISOString() },
      listings: { active: 10, mapReady: 7, missingLocations: 3 },
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

describe('GET /repeatables', () => {
  it('includes canonical NHTSA and VIN refresh schedules with monitoring metadata', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      queue: string
      defaultPattern: string
      lastRunAt: string | null
      lastStatus: string | null
      recentFailureCount: number
      recentFailureReason: string | null
    }>

    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'vin-enrich',
        queue: QUEUES.VIN_ENRICH,
        defaultPattern: '0 4/6 * * *',
        lastRunAt: null,
        lastStatus: null,
        recentFailureCount: 0,
        recentFailureReason: null,
      }),
      expect.objectContaining({
        id: 'nhtsa-recalls',
        queue: QUEUES.NHTSA_RECALLS,
        defaultPattern: '30 4 * * *',
      }),
      expect.objectContaining({
        id: 'nhtsa-complaints',
        queue: QUEUES.NHTSA_COMPLAINTS,
        defaultPattern: '0 5 * * 0',
      }),
      expect.objectContaining({
        id: 'nhtsa-safety-ratings',
        queue: QUEUES.NHTSA_SAFETY_RATINGS,
        defaultPattern: '0 6 * * 0',
      }),
    ]))

    await app.close()
  })
})
