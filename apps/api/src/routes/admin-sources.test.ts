import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

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
  it('keeps the six-hour stall default when no config service is provided', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Source', status: 'active', lastScrapedAt: null })) },
      {},
      factory,
      { getSourcePipelineStages: vi.fn(async () => [{ stage: 'detail-crawl', pendingCount: 1, lastCompletedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) }]) },
    )
    const response = await app.inject({ method: 'GET', url: '/sources/src-1/pipeline' })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.stages.find((stage: { stage: string }) => stage.stage === 'detail-crawl').stalled).toBe(true)
    await app.close()
  })

  it('uses the configured stall threshold', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Source', status: 'active', lastScrapedAt: null })) },
      {},
      factory,
      { getSourcePipelineStages: vi.fn(async () => [{ stage: 'detail-crawl', pendingCount: 1, lastCompletedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }]) },
      {},
      { getOperatorSetting: vi.fn(async () => 1) } as never,
    )
    const response = await app.inject({ method: 'GET', url: '/sources/src-1/pipeline' })
    expect(response.statusCode).toBe(200)
    expect(response.json().data.stages.find((stage: { stage: string }) => stage.stage === 'detail-crawl').stalled).toBe(true)
    await app.close()
  })

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

describe('GET /sources/:id/job-runs', () => {
  it('returns the source and its run tree from the repository', async () => {
    const factory = new MockQueueFactory()
    const tree = [
      {
        id: 'run-scrape-1',
        jobType: QUEUES.SOURCE_SCRAPE,
        sourceId: 'src-1',
        parentRunId: null,
        status: 'succeeded',
        startedAt: new Date('2026-06-18T10:00:00Z'),
        finishedAt: new Date('2026-06-18T10:01:00Z'),
        succeededCount: 10,
        failedCount: 0,
        errorMessage: null,
        children: [
          {
            id: 'run-resolve-1',
            jobType: QUEUES.LISTING_RESOLVE,
            sourceId: null,
            parentRunId: 'run-scrape-1',
            status: 'succeeded',
            startedAt: new Date('2026-06-18T10:01:30Z'),
            finishedAt: new Date('2026-06-18T10:01:45Z'),
            succeededCount: 10,
            failedCount: 0,
            errorMessage: null,
            children: [],
          },
        ],
      },
    ]
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'BLVD.com', status: 'active', lastScrapedAt: null })) },
      {},
      factory,
      {},
      { findRunTreeForSource: vi.fn(async () => tree) },
    )

    const res = await app.inject({ method: 'GET', url: '/sources/src-1/job-runs' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.source).toEqual({ id: 'src-1', name: 'BLVD.com' })
    expect(body.data.runs).toHaveLength(1)
    expect(body.data.runs[0].id).toBe('run-scrape-1')
    expect(body.data.runs[0].children).toHaveLength(1)
    expect(body.data.runs[0].children[0].id).toBe('run-resolve-1')
    expect(body.data.runs[0].children[0].parentRunId).toBe('run-scrape-1')

    await app.close()
  })

  it('returns 404 when source does not exist', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({ method: 'GET', url: '/sources/nonexistent/job-runs' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 503 when the repository throws', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'BLVD.com', status: 'active', lastScrapedAt: null })) },
      {},
      factory,
      {},
      { findRunTreeForSource: vi.fn(async () => { throw new Error('db down') }) },
    )

    const res = await app.inject({ method: 'GET', url: '/sources/src-1/job-runs' })
    expect(res.statusCode).toBe(503)

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

describe('POST /sources/:id/disable and /enable missing-source and defaults', () => {
  it('returns 404 and has no side effects when the source does not exist', async () => {
    const factory = new MockQueueFactory()
    const { app, sources, db } = buildTestApp({}, {}, factory)

    const disable = await app.inject({ method: 'POST', url: '/sources/missing/disable', payload: {} })
    const enable = await app.inject({ method: 'POST', url: '/sources/missing/enable', payload: {} })

    expect(disable.statusCode).toBe(404)
    expect(enable.statusCode).toBe(404)
    expect(sources.disable).not.toHaveBeenCalled()
    expect(sources.enable).not.toHaveBeenCalled()
    expect(db.configEntry.create).not.toHaveBeenCalled()
    expect(factory.getQueue(QUEUES.LISTING_SYNC)?.getEnqueued() ?? []).toHaveLength(0)
    await app.close()
  })

  it('uses the default reason and returns the disabled envelope', async () => {
    const { app, sources } = buildTestApp(
      { findById: vi.fn(async () => ({ id: 'src-1', name: 'Test Source', status: 'active', lastScrapedAt: null })) },
      {},
      new MockQueueFactory(),
    )
    const res = await app.inject({ method: 'POST', url: '/sources/src-1/disable', payload: {} })
    const reason = 'Disabled by authenticated operator action'
    expect(res.json()).toEqual({ data: { id: 'src-1', status: 'disabled', reason } })
    expect(sources.disable).toHaveBeenCalledWith('src-1', reason)
    await app.close()
  })
})
