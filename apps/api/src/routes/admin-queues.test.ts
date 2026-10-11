import { describe, expect, it, vi } from 'vitest'
import { MockQueueFactory, QUEUES, getQueuePolicy } from '@wivwav/queue'
import type { MockQueueAdapter } from '@wivwav/queue'
import { buildTestApp } from './admin-test-fixtures.js'

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

describe('DELETE /queues/:name/failed', () => {
  it('cleans failed jobs and returns the removed count', async () => {
    const factory = new MockQueueFactory()
    const queue = factory.createQueue(QUEUES.GEOCODE) as MockQueueAdapter
    const cleanFailed = vi.spyOn(queue, 'cleanFailed').mockResolvedValue(3)
    const { app } = buildTestApp({}, {}, factory)

    const res = await app.inject({ method: 'DELETE', url: `/queues/${QUEUES.GEOCODE}/failed` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { removed: 3 } })
    expect(cleanFailed).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('returns 404 for an unknown queue name', async () => {
    const { app } = buildTestApp({}, {}, new MockQueueFactory())
    const res = await app.inject({ method: 'DELETE', url: '/queues/nope/failed' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('unknown queue handling on mutating queue routes', () => {
  it.each([
    ['POST', '/queues/nope/jobs'],
    ['POST', '/queues/nope/pause'],
    ['POST', '/queues/nope/resume'],
  ])('%s %s returns 404', async (method, url) => {
    const { app } = buildTestApp({}, {}, new MockQueueFactory())
    const res = await app.inject({ method: method as 'POST', url, payload: {} })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('rejects enqueue on a source-scoped queue without data.sourceId', async () => {
    const factory = new MockQueueFactory()
    const { app } = buildTestApp({}, {}, factory)
    const res = await app.inject({
      method: 'POST',
      url: `/queues/${QUEUES.DETAIL_CRAWL}/jobs`,
      payload: { data: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
    expect(factory.getQueue(QUEUES.DETAIL_CRAWL)?.getEnqueued()).toHaveLength(0)
    await app.close()
  })
})
