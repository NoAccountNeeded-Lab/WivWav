import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobRecord } from '@wivwav/queue'
import { adminAiRoutes } from './admin-ai.js'

function buildTestApp(sources: unknown, queueFactory?: unknown) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(adminAiRoutes, {
    sources: sources as never,
    ollamaBaseUrl: 'http://ollama.test',
    queueFactory: (queueFactory ?? {
      createQueue: () => ({ getJobs: vi.fn(async () => []) }),
    }) as never,
  })
  return app
}

const emptySources = {
  findNeedingRemapping: vi.fn(async () => []),
}

function buildQueueFactory(jobs: Partial<JobRecord>[]) {
  return {
    createQueue: vi.fn((_name: string) => ({
      getJobs: vi.fn(async () => jobs),
    })),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GET /status', () => {
  it('returns installed and loaded Ollama model stats', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return Response.json({
          models: [{ name: 'llama3.2:latest', size: 2_016_000_000, modified_at: '2026-05-30T10:00:00Z' }],
        })
      }

      if (url.endsWith('/api/ps')) {
        return Response.json({
          models: [
            {
              model: 'llama3.2:latest',
              size: 2_016_000_000,
              size_vram: 1_920_000_000,
              processor: '100% GPU',
              context: 4096,
              expires_at: '2026-05-30T10:05:00Z',
            },
          ],
        })
      }

      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const app = buildTestApp(emptySources)
    const res = await app.inject({ method: 'GET', url: '/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.ollama).toMatchObject({
      available: true,
      baseUrl: 'http://ollama.test',
      models: ['llama3.2:latest'],
      runningModels: [
        {
          name: 'llama3.2:latest',
          sizeBytes: 2_016_000_000,
          vramBytes: 1_920_000_000,
          processor: '100% GPU',
          contextWindow: 4096,
          expiresAt: '2026-05-30T10:05:00Z',
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith('http://ollama.test/api/tags', expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith('http://ollama.test/api/ps', expect.any(Object))

    await app.close()
  })

  it('keeps status available when runtime stats cannot be read', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'llama3.2:latest' }] })
      }

      throw new Error('ps failed')
    })
    vi.stubGlobal('fetch', fetchMock)

    const app = buildTestApp(emptySources)
    const res = await app.inject({ method: 'GET', url: '/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.ollama).toMatchObject({
      available: true,
      models: ['llama3.2:latest'],
      runningModels: [],
    })

    await app.close()
  })
})

describe('POST /explain-error', () => {
  it('returns an AI explanation for a failed job', async () => {
    const queueFactory = buildQueueFactory([
      {
        id: 'job-1',
        name: 'detail-crawl',
        data: { sourceId: 'src-1' },
        status: 'failed',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        failedReason: 'TimeoutError: navigation timed out after 30000ms',
        attemptsMade: 3,
        progress: null,
        logs: [],
      },
    ])
    const fetchMock = vi.fn(async () =>
      Response.json({ response: 'This looks like a slow or unreachable page.', done: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'detail-crawl', jobId: 'job-1' } },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ explanation: 'This looks like a slow or unreachable page.' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.test/api/generate',
      expect.objectContaining({ method: 'POST' }),
    )

    await app.close()
  })

  it('returns 404 when the job is not found', async () => {
    const queueFactory = buildQueueFactory([])
    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'detail-crawl', jobId: 'missing' } },
    })

    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('returns a clear error state when Ollama is unreachable rather than hanging', async () => {
    const queueFactory = buildQueueFactory([
      {
        id: 'job-1',
        name: 'detail-crawl',
        data: {},
        status: 'failed',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        failedReason: 'TimeoutError: navigation timed out after 30000ms',
        attemptsMade: 3,
        progress: null,
        logs: [],
      },
    ])
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)

    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'detail-crawl', jobId: 'job-1' } },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('OLLAMA_UNAVAILABLE')

    await app.close()
  })

  it('returns 400 when the job has no recorded failure reason', async () => {
    const queueFactory = buildQueueFactory([
      {
        id: 'job-1',
        name: 'detail-crawl',
        data: {},
        status: 'failed',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        attemptsMade: 1,
        progress: null,
        logs: [],
      },
    ])
    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'detail-crawl', jobId: 'job-1' } },
    })

    expect(res.statusCode).toBe(400)

    await app.close()
  })

  it('rejects a queue name that is not a known registered queue', async () => {
    const queueFactory = buildQueueFactory([])
    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'not-a-real-queue', jobId: 'job-1' } },
    })

    expect(res.statusCode).toBe(404)
    // Must reject before ever calling createQueue, since that would
    // otherwise lazily instantiate an arbitrary BullMQ queue.
    expect(queueFactory.createQueue).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns 502 when Ollama responds with a non-ok status', async () => {
    const queueFactory = buildQueueFactory([
      {
        id: 'job-1',
        name: 'detail-crawl',
        data: {},
        status: 'failed',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        failedReason: 'TimeoutError: navigation timed out after 30000ms',
        attemptsMade: 3,
        progress: null,
        logs: [],
      },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500, statusText: 'Internal Server Error' })))

    const app = buildTestApp(emptySources, queueFactory)
    const res = await app.inject({
      method: 'POST',
      url: '/explain-error',
      payload: { data: { queue: 'detail-crawl', jobId: 'job-1' } },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('OLLAMA_ERROR')

    await app.close()
  })
})
