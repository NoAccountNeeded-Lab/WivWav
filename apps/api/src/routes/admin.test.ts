import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES, getQueuePolicy } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { adminRoutes } from './admin.js'

function buildDefaultListingRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(async () => null),
    findByIdForSafety: vi.fn(async () => null),
    findVehicleModelWithSafetyData: vi.fn(async () => null),
    findManyActive: vi.fn(async () => []),
    countObservedActive: vi.fn(async () => 0),
    countActive: vi.fn(async () => 0),
    countActiveWithCoordinates: vi.fn(async () => 0),
    countActiveMissingCoordinates: vi.fn(async () => 0),
    getPublicationCountsBySource: vi.fn(async () => []),
    findPriceHistory: vi.fn(async () => []),
    findQuarantined: vi.fn(async () => []),
    countQuarantined: vi.fn(async () => 0),
    reprocessQuarantined: vi.fn(async () => true),
    findFieldConflicts: vi.fn(async () => []),
    countFieldConflicts: vi.fn(async () => 0),
    findListingReportTriage: vi.fn(async () => []),
    countListingReportTriage: vi.fn(async () => 0),
    findSemanticAnalysesForImage: vi.fn(async () => []),
    getSourcePipelineStages: vi.fn(async () => []),
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
    findNeedingRemapping: vi.fn(async () => []),
    disable: vi.fn(async () => true),
    enable: vi.fn(async () => true),
    updateCronExpression: vi.fn(async () => true),
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
  listingRepoOverrides: Record<string, unknown> = {},
) {
  const app = Fastify()
  void app.register(sensible)
  const listings = buildDefaultListingRepo(listingRepoOverrides)
  const sources = buildDefaultSourceRepo(sourceRepoOverrides)
  const scraperRuns = buildDefaultScraperRunRepo(scraperRunRepoOverrides)
  const db = {
    configEntry: {
      create: vi.fn(async ({ data }) => ({ id: 'cfg-1', ...data })),
      findMany: vi.fn(async () => []),
    },
  }
  void app.register(adminRoutes, { db: db as never, listings: listings as never, sources: sources as never, scraperRuns: scraperRuns as never, queueFactory: factory as never })
  return { app, listings, sources, scraperRuns, db }
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
    expect(body.data[0]).toMatchObject({
      name: expect.any(String),
      paused: false,
      stats: expect.any(Object),
      policy: expect.objectContaining(getQueuePolicy(body.data[0].name)),
    })
    await app.close()
  })

  it('returns 503 with error envelope when queue service throws', async () => {
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
    expect(data.policy).toEqual(getQueuePolicy(QUEUES.SOURCE_SCRAPE))
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

  it.each([
    [QUEUES.DETAIL_CRAWL, 'missing', {}],
    [QUEUES.DETAIL_CRAWL, 'empty', { sourceId: '   ' }],
    [QUEUES.DETAIL_EXTRACT, 'missing', {}],
    [QUEUES.DETAIL_EXTRACT, 'empty', { sourceId: '   ' }],
  ])(
    'rejects %s jobs with a %s source id',
    async (queueName, _case, data) => {
      const factory = new MockQueueFactory()
      const { app } = buildTestApp({}, {}, factory)

      const res = await app.inject({
        method: 'POST',
        url: `/queues/${queueName}/jobs`,
        payload: { data },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({
        error: {
          code: 'BAD_REQUEST',
          message: `Queue "${queueName}" requires a non-empty data.sourceId`,
        },
      })
      expect(factory.getQueue(queueName)?.getEnqueued()).toHaveLength(0)

      await app.close()
    },
  )

  it.each([QUEUES.DETAIL_CRAWL, QUEUES.DETAIL_EXTRACT])(
    'enqueues %s jobs with a source id',
    async queueName => {
      const factory = new MockQueueFactory()
      const { app } = buildTestApp({}, {}, factory)

      const res = await app.inject({
        method: 'POST',
        url: `/queues/${queueName}/jobs`,
        payload: { data: { sourceId: 'src-1' } },
      })

      expect(res.statusCode).toBe(201)
      expect(factory.getQueue(queueName)?.getEnqueued()[0]?.data).toMatchObject({
        sourceId: 'src-1',
        traceId: expect.any(String),
      })

      await app.close()
    },
  )

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

  it('returns 409 when the source is disabled', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Test Source', status: 'disabled', lastScrapedAt: null })) },
      {},
      factory,
    )

    const res = await app.inject({ method: 'POST', url: '/sources/src-1/run' })
    expect(res.statusCode).toBe(409)
    expect(factory.getQueue(QUEUES.SOURCE_SCRAPE)?.getEnqueued()).toHaveLength(0)

    await app.close()
  })
})

describe('POST /sources/:id/disable and /enable', () => {
  it('persists audit state and enqueues a search rebuild when disabling a source', async () => {
    const factory = new MockQueueFactory()
    const { app, sources, db } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Test Source', status: 'active', lastScrapedAt: null })) },
      {},
      factory,
    )

    const res = await app.inject({
      method: 'POST',
      url: '/sources/src-1/disable',
      payload: { reason: 'Rollback' },
    })

    expect(res.statusCode).toBe(200)
    expect(sources.disable).toHaveBeenCalledWith('src-1', 'Rollback')
    expect(db.configEntry.create).toHaveBeenCalled()
    expect(factory.getQueue(QUEUES.LISTING_SYNC)?.getEnqueued()).toHaveLength(1)
    await app.close()
  })

  it('persists audit state and enqueues a search rebuild when enabling a source', async () => {
    const factory = new MockQueueFactory()
    const { app, sources, db } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Test Source', status: 'disabled', lastScrapedAt: null })) },
      {},
      factory,
    )

    const res = await app.inject({ method: 'POST', url: '/sources/src-1/enable' })

    expect(res.statusCode).toBe(200)
    expect(sources.enable).toHaveBeenCalledWith('src-1')
    expect(db.configEntry.create).toHaveBeenCalled()
    expect(factory.getQueue(QUEUES.LISTING_SYNC)?.getEnqueued()).toHaveLength(1)
    await app.close()
  })
})

describe('GET /sources/:id/pipeline', () => {
  it('returns source-scrape plus DB-derived stages with pending/failed/stall state', async () => {
    const now = new Date('2026-06-18T10:00:00Z')
    const staleCompletion = new Date('2026-06-17T00:00:00Z') // > 6h stall threshold before `now`
    const factory = new MockQueueFactory()
    await factory.createQueue(QUEUES.DETAIL_CRAWL).add({ sourceId: 'src-1' })
    ;(factory.getQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter).markFailed('TimeoutError: navigation timed out')
    const { app } = buildTestApp(
      {
        findById: vi.fn(async () => ({ id: 'src-1', name: 'BLVD.com', status: 'active', lastScrapedAt: now })),
      },
      {},
      factory,
      {
        getSourcePipelineStages: vi.fn(async () => [
          { stage: 'detail-crawl', pendingCount: 5, lastCompletedAt: staleCompletion },
          { stage: 'detail-extract', pendingCount: 0, lastCompletedAt: now },
          { stage: 'geocode', pendingCount: 2, lastCompletedAt: null },
          { stage: 'vin-enrich', pendingCount: 0, lastCompletedAt: now },
        ]),
      },
    )

    const res = await app.inject({ method: 'GET', url: '/sources/src-1/pipeline' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.source).toEqual({ id: 'src-1', name: 'BLVD.com' })

    const byStage = Object.fromEntries(
      (body.data.stages as Array<{ stage: string }>).map((s) => [s.stage, s]),
    )
    expect(Object.keys(byStage)).toEqual(['source-scrape', 'detail-crawl', 'detail-extract', 'geocode', 'vin-enrich'])

    // detail-crawl: pending work, last completion older than the stall threshold → stalled
    expect(byStage['detail-crawl']).toMatchObject({ pendingCount: 5, stalled: true, failedCount: 1, latestFailedJobId: '1' })
    // detail-extract: no pending work → never stalled regardless of last completion
    expect(byStage['detail-extract']).toMatchObject({ pendingCount: 0, stalled: false })
    // geocode: pending work, never completed → stalled
    expect(byStage['geocode']).toMatchObject({ pendingCount: 2, lastCompletedAt: null, stalled: true })

    await app.close()
  })

  it('returns 404 when source does not exist', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'GET', url: '/sources/nonexistent/pipeline' })
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
      {
        getPublicationCountsBySource: vi.fn(async () => [{
          sourceId: 'src-1',
          observedActive: 5,
          eligibleActive: 2,
        }]),
      },
    )

    const res = await app.inject({ method: 'GET', url: '/sources' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].name).toBe('test-source')
    expect(res.json().data[0]).toMatchObject({
      observedActiveCount: 5,
      eligibleActiveCount: 2,
    })

    await app.close()
  })
})

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

describe('GET /repeatables', () => {
  it('does not report one legacy collided schedule as enabled for both sources', async () => {
    const factory = new MockQueueFactory()
    const crawlQueue = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    crawlQueue.seedRepeatable({
      key: 'legacy-crawl',
      name: QUEUES.DETAIL_CRAWL,
      id: null,
      tz: 'America/New_York',
      pattern: '0 * * * *',
      next: Date.now() + 60_000,
      legacy: true,
    })
    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/New_York' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    const schedules = res.json().data as Array<{ id: string; enabled: boolean }>
    expect(schedules.find((schedule) => schedule.id === 'blvd-crawl')?.enabled).toBe(false)
    expect(schedules.find((schedule) => schedule.id === 'mw-crawl')?.enabled).toBe(false)

    await app.close()
  })

  it('returns independent source-specific crawl and extract schedules with live state', async () => {
    const factory = new MockQueueFactory()
    const crawlQueue = factory.createQueue(QUEUES.DETAIL_CRAWL) as MockQueueAdapter
    const extractQueue = factory.createQueue(QUEUES.DETAIL_EXTRACT) as MockQueueAdapter
    await crawlQueue.addRepeatable(
      QUEUES.DETAIL_CRAWL,
      { sourceId: 'blvd-id' },
      '0 * * * *',
      'America/New_York',
      'blvd-crawl',
    )
    await crawlQueue.addRepeatable(
      QUEUES.DETAIL_CRAWL,
      { sourceId: 'mw-id' },
      '0 * * * *',
      'America/Chicago',
      'mw-crawl',
    )
    await extractQueue.addRepeatable(
      QUEUES.DETAIL_EXTRACT,
      { sourceId: 'blvd-id' },
      '*/5 * * * *',
      'America/New_York',
      'blvd-extract',
    )
    await extractQueue.addRepeatable(
      QUEUES.DETAIL_EXTRACT,
      { sourceId: 'mw-id' },
      '*/5 * * * *',
      'America/Chicago',
      'mw-extract',
    )
    await crawlQueue.add({ sourceId: 'blvd-id' })
    crawlQueue.markFailed('BLVD crawl failed')
    await crawlQueue.add({ sourceId: 'mw-id' })
    crawlQueue.markCompleted()

    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/Chicago' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })

    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      jobId: string
      label: string
      data: { sourceId: string }
      enabled: boolean
      key: string
      pattern: string
      tz: string
      next: number
      lastStatus: string | null
    }>
    expect(schedules.filter((schedule) =>
      schedule.id.endsWith('-crawl') || schedule.id.endsWith('-extract'),
    )).toEqual([
      expect.objectContaining({
        id: 'blvd-crawl',
        jobId: 'blvd-crawl',
        label: 'BLVD.com detail crawl (Playwright)',
        data: { sourceId: 'blvd-id' },
        enabled: true,
        key: 'blvd-crawl',
        pattern: '0 * * * *',
        tz: 'America/New_York',
        next: expect.any(Number),
        lastStatus: 'failed',
      }),
      expect.objectContaining({
        id: 'mw-crawl',
        jobId: 'mw-crawl',
        label: 'MobilityWorks detail crawl (Playwright)',
        data: { sourceId: 'mw-id' },
        enabled: true,
        key: 'mw-crawl',
        pattern: '0 * * * *',
        tz: 'America/Chicago',
        next: expect.any(Number),
        lastStatus: 'completed',
      }),
      expect.objectContaining({
        id: 'blvd-extract',
        jobId: 'blvd-extract',
        data: { sourceId: 'blvd-id' },
        enabled: true,
        next: expect.any(Number),
      }),
      expect.objectContaining({
        id: 'mw-extract',
        jobId: 'mw-extract',
        data: { sourceId: 'mw-id' },
        enabled: true,
        next: expect.any(Number),
      }),
    ])

    await app.close()
  })

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
        id: 'listing-sync',
        queue: QUEUES.LISTING_SYNC,
        defaultPattern: '30 1 * * *',
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

  it('attributes source-scrape failures to the source that actually failed, not to every per-source schedule sharing the queue', async () => {
    const factory = new MockQueueFactory()
    const scrapeQueue = factory.createQueue(QUEUES.SOURCE_SCRAPE) as MockQueueAdapter

    await scrapeQueue.add({ sourceId: 'blvd-id' })
    scrapeQueue.markFailed('page.goto: Timeout 30000ms exceeded.')
    await scrapeQueue.add({ sourceId: 'mw-id' })

    const { app } = buildTestApp({
      findScheduledSources: vi.fn(async () => [
        { id: 'blvd-id', name: 'BLVD.com', cronExpression: '0 */6 * * *', timezone: 'America/New_York' },
        { id: 'mw-id', name: 'MobilityWorks', cronExpression: '0 */8 * * *', timezone: 'America/New_York' },
      ]),
    }, {}, factory)

    const res = await app.inject({ method: 'GET', url: '/repeatables' })
    expect(res.statusCode).toBe(200)
    const schedules = res.json().data as Array<{
      id: string
      lastStatus: string | null
      recentFailureCount: number
      recentFailureReason: string | null
    }>

    const blvd = schedules.find(s => s.id === 'blvd')
    const mw = schedules.find(s => s.id === 'mw')

    expect(blvd).toMatchObject({
      lastStatus: 'failed',
      recentFailureCount: 1,
      recentFailureReason: 'page.goto: Timeout 30000ms exceeded.',
    })
    expect(mw).toMatchObject({
      lastStatus: null,
      recentFailureCount: 0,
      recentFailureReason: null,
    })

    await app.close()
  })
})

// ── Quarantine ──────────────────────────────────────────────────────────────

function makeQuarantinedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sourceId: 'src-1',
    sourceName: 'BLVD.com',
    sourceUrl: 'https://example.com/listing-1',
    sourceRecordKey: 'rec-1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    qualityIssueCodes: ['contains_space'],
    qualityCheckedAt: new Date('2026-06-01T00:00:00Z'),
    scrapedAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    extractionVersion: 'source-card-v1',
    ...overrides,
  }
}

describe('GET /quarantine', () => {
  it('returns quarantined listings with rule severity attached', async () => {
    const factory = new MockQueueFactory()
    const row = makeQuarantinedRow()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => [row]),
      countQuarantined: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/quarantine' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: 'listing-1',
      rules: [{ code: 'contains_space', severity: 'error' }],
      extractionVersion: 'source-card-v1',
    })
    expect(body.meta).toMatchObject({ total: 1 })
    expect(listings.findQuarantined).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }))

    await app.close()
  })

  it('passes sourceId and rule filters through to the repository', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?sourceId=src-1&rule=contains_space&olderThanDays=7' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', rule: 'contains_space', olderThanMs: 7 * 24 * 60 * 60 * 1000 }),
    )

    await app.close()
  })

  it('resolves a severity filter to its set of rule codes', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?severity=error' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ rule: expect.arrayContaining(['contains_space', 'active_with_sold_at']) }),
    )

    await app.close()
  })

  it('short-circuits when rule and severity filters contradict each other', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    // contains_space is severity 'error'; asking for severity=warn with that rule cannot match.
    const res = await app.inject({ method: 'GET', url: '/quarantine?rule=contains_space&severity=warn' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], meta: { total: 0, skip: 0, take: 0 } })
    expect(listings.findQuarantined).not.toHaveBeenCalled()

    await app.close()
  })

  it('caps take at the maximum page size', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findQuarantined: vi.fn(async () => []),
      countQuarantined: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/quarantine?take=10000' })

    expect(listings.findQuarantined).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))

    await app.close()
  })
})

describe('POST /quarantine/:id/reprocess', () => {
  it('reprocesses a quarantined listing', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      reprocessQuarantined: vi.fn(async () => true),
    })

    const res = await app.inject({ method: 'POST', url: '/quarantine/listing-1/reprocess' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { reprocessed: true } })
    expect(listings.reprocessQuarantined).toHaveBeenCalledWith('listing-1')

    await app.close()
  })

  it('returns 404 when the listing is not quarantined', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory, {
      reprocessQuarantined: vi.fn(async () => false),
    })

    const res = await app.inject({ method: 'POST', url: '/quarantine/missing/reprocess' })

    expect(res.statusCode).toBe(404)

    await app.close()
  })
})

function makeFieldConflictRow(overrides: Record<string, unknown> = {}) {
  return {
    listingId: 'listing-1',
    sourceUrl: 'https://dealer.example.com/listing/1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    field: 'conversionType',
    competingValues: ['side_entry', 'rear_entry'],
    evidenceKinds: ['structured_source', 'vehicle_text'],
    sourceRefs: ['https://dealer.example.com/listing/1', 'https://dealer.example.com/listing/1/detail'],
    observedAts: [new Date('2026-01-01'), new Date('2026-01-02')],
    detectedAt: new Date('2026-01-02'),
    ...overrides,
  }
}

describe('GET /field-conflicts', () => {
  it('returns unresolved field conflicts with competing claims', async () => {
    const factory = new MockQueueFactory()
    const row = makeFieldConflictRow()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => [row]),
      countFieldConflicts: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/field-conflicts' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      listingId: 'listing-1',
      field: 'conversionType',
      competingValues: ['side_entry', 'rear_entry'],
      evidenceKinds: ['structured_source', 'vehicle_text'],
    })
    expect(body.meta).toMatchObject({ total: 1 })
    expect(listings.findFieldConflicts).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 50 }))

    await app.close()
  })

  it('passes sourceId and field filters through to the repository', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => []),
      countFieldConflicts: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/field-conflicts?sourceId=src-1&field=rampType' })

    expect(listings.findFieldConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', field: 'rampType' }),
    )
    expect(listings.countFieldConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'src-1', field: 'rampType' }),
    )

    await app.close()
  })

  it('caps take at the maximum page size', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory, {
      findFieldConflicts: vi.fn(async () => []),
      countFieldConflicts: vi.fn(async () => 0),
    })

    await app.inject({ method: 'GET', url: '/field-conflicts?take=10000' })

    expect(listings.findFieldConflicts).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))

    await app.close()
  })
})

describe('GET /listing-reports', () => {
  it('returns unresolved listing report triage rows with pagination metadata', async () => {
    const factory = new MockQueueFactory()
    const rows = [{
      listingId: 'listing-1',
      sourceUrl: 'https://example.com/listing-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      unresolvedCount: 4,
      latestReportedAt: new Date('2026-07-14T08:00:00Z'),
      reportTypes: ['specs_incorrect', 'sold_or_stale'],
    }]
    const { app, listings } = buildTestApp({}, {}, factory, {
      findListingReportTriage: vi.fn(async () => rows),
      countListingReportTriage: vi.fn(async () => 1),
    })

    const res = await app.inject({ method: 'GET', url: '/listing-reports?minReports=3&skip=5&take=10' })

    expect(res.statusCode).toBe(200)
    expect(listings.findListingReportTriage).toHaveBeenCalledWith({ minReports: 3, skip: 5, take: 10 })
    expect(listings.countListingReportTriage).toHaveBeenCalledWith({ minReports: 3 })
    expect(res.json()).toEqual({
      data: [{
        ...rows[0],
        latestReportedAt: '2026-07-14T08:00:00.000Z',
      }],
      meta: { total: 1, skip: 5, take: 10 },
    })

    await app.close()
  })

  it('caps take and defaults minReports to one', async () => {
    const factory = new MockQueueFactory()
    const { app, listings } = buildTestApp({}, {}, factory)

    await app.inject({ method: 'GET', url: '/listing-reports?take=10000&minReports=0' })

    expect(listings.findListingReportTriage).toHaveBeenCalledWith({ minReports: 1, skip: 0, take: 200 })

    await app.close()
  })
})

describe('GET /images/:imageId/semantic-analyses', () => {
  it('returns full semantic image analysis attempts including low-confidence and failures', async () => {
    const factory = new MockQueueFactory()
    const rows = [
      {
        id: 'attempt-1',
        listingImageId: 'image-1',
        contentHash: 'sha256-ok',
        semanticAnalysisVersion: 1,
        provider: 'provider',
        model: 'model',
        schemaVersion: '1',
        status: 'success',
        errorCode: null,
        errorMessage: null,
        labels: [{ label: 'ramp', confidence: 0.4 }],
        fieldClaims: [{ field: 'rampType', claimedValue: 'fold_out', confidence: 0.4 }],
        altText: null,
        summary: 'low confidence ramp candidate',
        observedAt: new Date('2026-07-20T01:00:00Z'),
        createdAt: new Date('2026-07-20T01:00:00Z'),
        listingImage: {
          id: 'image-1',
          listingId: 'listing-1',
          originalUrl: 'https://dealer.example.com/ramp.jpg',
          normalizedUrl: 'https://dealer.example.com/ramp.jpg',
          position: 0,
        },
      },
      {
        id: 'attempt-2',
        listingImageId: 'image-1',
        contentHash: 'sha256-failed',
        semanticAnalysisVersion: 1,
        provider: 'provider',
        model: 'model',
        schemaVersion: '1',
        status: 'error',
        errorCode: 'provider_error',
        errorMessage: 'timeout',
        labels: [],
        fieldClaims: [],
        altText: null,
        summary: null,
        observedAt: new Date('2026-07-20T02:00:00Z'),
        createdAt: new Date('2026-07-20T02:00:00Z'),
        listingImage: {
          id: 'image-1',
          listingId: 'listing-1',
          originalUrl: 'https://dealer.example.com/ramp.jpg',
          normalizedUrl: 'https://dealer.example.com/ramp.jpg',
          position: 0,
        },
      },
    ]
    const { app, listings } = buildTestApp({}, {}, factory, {
      findSemanticAnalysesForImage: vi.fn(async () => rows),
    })

    const res = await app.inject({ method: 'GET', url: '/images/image-1/semantic-analyses' })

    expect(res.statusCode).toBe(200)
    expect(listings.findSemanticAnalysesForImage).toHaveBeenCalledWith('image-1')
    expect(res.json()).toMatchObject({
      data: [
        { id: 'attempt-1', status: 'success', fieldClaims: [{ confidence: 0.4 }] },
        { id: 'attempt-2', status: 'error', errorCode: 'provider_error', errorMessage: 'timeout' },
      ],
    })

    await app.close()
  })
})
