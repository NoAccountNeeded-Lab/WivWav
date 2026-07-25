import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockQueueFactory } from '@wivwav/queue'
import { correlationRoutes } from './correlation.js'

const LOKI_URL = 'http://loki.test'

function buildDefaultSourceRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(async () => null),
    ...overrides,
  }
}

function buildDefaultScraperRunRepo(overrides: Record<string, unknown> = {}) {
  return {
    findRecent: vi.fn(async () => []),
    ...overrides,
  }
}

function buildTestApp(opts: {
  sourceRepoOverrides?: Record<string, unknown>
  scraperRunRepoOverrides?: Record<string, unknown>
  factory?: MockQueueFactory
} = {}) {
  const app = Fastify()
  void app.register(sensible)
  const sources = buildDefaultSourceRepo(opts.sourceRepoOverrides)
  const scraperRuns = buildDefaultScraperRunRepo(opts.scraperRunRepoOverrides)
  const factory = opts.factory ?? new MockQueueFactory()

  void app.register(correlationRoutes, {
    sources: sources as never,
    scraperRuns: scraperRuns as never,
    queueFactory: factory as never,
    lokiUrl: LOKI_URL,
  })
  return { app, sources, scraperRuns }
}

function lokiStreams(entries: Array<{ tsNs: string; line: unknown }>) {
  return Response.json({
    status: 'success',
    data: {
      resultType: 'streams',
      result: [{ stream: {}, values: entries.map((e) => [e.tsNs, JSON.stringify(e.line)] as [string, string]) }],
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GET / — idType validation', () => {
  it('rejects a missing idType', async () => {
    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?id=abc' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_ID_TYPE')
    await app.close()
  })

  it('rejects an idType outside the allow-list', async () => {
    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=userId&id=abc' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_ID_TYPE')
    await app.close()
  })

  it('rejects an SQL-injection-shaped idType the same as any other disallowed value', async () => {
    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: `/?${new URLSearchParams({ idType: "jobId'; DROP TABLE job_run;--", id: 'x' })}` })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects a missing id', async () => {
    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=requestId' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('MISSING_ID')
    await app.close()
  })
})

describe('GET / — sourceId correlation', () => {
  it('returns 404 for an unknown sourceId', async () => {
    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=sourceId&id=missing' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns the source and its recent runs, windowed and capped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => lokiStreams([])))
    const { app } = buildTestApp({
      sourceRepoOverrides: {
        findById: vi.fn(async () => ({ id: 'src-1', name: 'Acme', status: 'active', lastScrapedAt: null })),
      },
      scraperRunRepoOverrides: {
        findRecent: vi.fn(async () => [
          { id: 'run-1', sourceId: 'src-1', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), success: true },
          { id: 'run-2', sourceId: 'other-source', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), success: true },
        ]),
      },
    })

    const res = await app.inject({ method: 'GET', url: '/?idType=sourceId&id=src-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { entities: { source: { id: string }; runs: Array<{ id: string }> } } }
    expect(body.data.entities.source.id).toBe('src-1')
    expect(body.data.entities.runs).toHaveLength(1)
    expect(body.data.entities.runs[0]?.id).toBe('run-1')

    await app.close()
  })
})

describe('GET / — requestId correlation', () => {
  it('returns empty entities and correlated logs', async () => {
    const tsNs = String(BigInt(Date.now()) * 1_000_000n)
    vi.stubGlobal('fetch', vi.fn(async () => lokiStreams([{ tsNs, line: { level: 30, msg: 'ok', requestId: 'req-1' } }])))

    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=requestId&id=req-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { entities: Record<string, unknown>; logs: { lines: unknown[]; truncated: boolean } } }
    expect(body.data.entities).toEqual({})
    expect(body.data.logs.lines).toHaveLength(1)
    expect(body.data.logs.truncated).toBe(false)

    await app.close()
  })

  it('only correlates entries whose parsed field actually matches (not just a substring hit)', async () => {
    const tsNs = String(BigInt(Date.now()) * 1_000_000n)
    // The message body contains "req-1" as a substring, but its requestId field is different.
    vi.stubGlobal('fetch', vi.fn(async () => lokiStreams([
      { tsNs, line: { level: 30, msg: 'unrelated mentions req-1 in passing', requestId: 'req-other' } },
    ])))

    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=requestId&id=req-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { logs: { lines: unknown[] } } }
    expect(body.data.logs.lines).toHaveLength(0)

    await app.close()
  })

  it('caps returned log lines at 100 and reports truncated', async () => {
    const entries = Array.from({ length: 150 }, (_, i) => ({
      tsNs: String(BigInt(Date.now() - i) * 1_000_000n),
      line: { level: 30, msg: `line ${i}`, requestId: 'req-1' },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => lokiStreams(entries)))

    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=requestId&id=req-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { logs: { lines: unknown[]; truncated: boolean } } }
    expect(body.data.logs.lines).toHaveLength(100)
    expect(body.data.logs.truncated).toBe(true)

    await app.close()
  })

  it('reports logs.unavailable when Loki is unreachable, without failing the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))

    const { app } = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/?idType=requestId&id=req-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { logs: { unavailable: boolean; lines: unknown[] } } }
    expect(body.data.logs.unavailable).toBe(true)
    expect(body.data.logs.lines).toHaveLength(0)

    await app.close()
  })

  it('never includes a planted secret-shaped value from a job payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => lokiStreams([])))
    const factory = new MockQueueFactory()
    // Enqueue a job whose data carries a secret-shaped field — get_correlation
    // must only surface the curated job fields, never the raw `data` payload.
    const queue = factory.createQueue('source-scrape')
    await queue.add({ sourceId: 'src-1', apiSecret: 'sk-live-should-never-leak' }, { jobId: 'job-1' })

    const { app } = buildTestApp({ factory })
    const res = await app.inject({ method: 'GET', url: '/?idType=jobId&id=job-1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('sk-live-should-never-leak')

    await app.close()
  })
})
