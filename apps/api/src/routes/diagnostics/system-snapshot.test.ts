import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockQueueFactory } from '@wivwav/queue'
import type { Config } from '../../config.js'
import { healthRoutes } from '../health.js'
import { adminRoutes } from '../admin.js'
import { systemSnapshotRoutes } from './system-snapshot.js'

const LOKI_URL = 'http://loki.test'

const baseConfig: Config = {
  NODE_ENV: 'test',
  PORT: 3001,
  HOST: '0.0.0.0',
  RATE_LIMIT_MAX: 100,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/wivwav',
  MEILISEARCH_HOST: 'http://localhost:7700',
  MEILISEARCH_API_KEY: 'test',
  MEILISEARCH_INDEX_NAME: 'listings',
  VALKEY_URL: 'redis://localhost:6379',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_REQUIRED: false,
  LOKI_URL,
  GRAFANA_URL: 'http://localhost:3003',
  CORS_ORIGIN: 'http://localhost:3000',
  GIT_SHA: 'test-sha',
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

function buildDefaultListingRepo(overrides: Record<string, unknown> = {}) {
  return {
    getPublicationCountsBySource: vi.fn(async () => []),
    ...overrides,
  }
}

interface BuildOpts {
  sourceRepoOverrides?: Record<string, unknown>
  scraperRunRepoOverrides?: Record<string, unknown>
  listingRepoOverrides?: Record<string, unknown>
  db?: Record<string, unknown>
  meili?: Record<string, unknown>
  cache?: Record<string, unknown>
  config?: Partial<Config>
  factory?: MockQueueFactory
}

function buildTestApp(opts: BuildOpts = {}) {
  const app = Fastify()
  void app.register(sensible)

  const sources = buildDefaultSourceRepo(opts.sourceRepoOverrides)
  const scraperRuns = buildDefaultScraperRunRepo(opts.scraperRunRepoOverrides)
  const listings = buildDefaultListingRepo(opts.listingRepoOverrides)
  const db = opts.db ?? {
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
    configEntry: { findMany: vi.fn(async () => []) },
  }
  const meili = opts.meili ?? { health: vi.fn(async () => ({ status: 'available' })) }
  const cache = opts.cache ?? { ping: vi.fn(async () => undefined) }
  const config = { ...baseConfig, ...opts.config }
  const factory = opts.factory ?? new MockQueueFactory()

  void app.register(healthRoutes, {
    prefix: '/health',
    db: db as never,
    sources: sources as never,
    scraperRuns: scraperRuns as never,
    meili: meili as never,
    cache: cache as never,
    config,
  })
  void app.register(adminRoutes, {
    prefix: '/admin',
    db: db as never,
    listings: listings as never,
    sources: sources as never,
    scraperRuns: scraperRuns as never,
    jobRuns: { findRunTreeForSource: vi.fn(async () => []) } as never,
    queueFactory: factory as never,
  })
  void app.register(systemSnapshotRoutes, {
    prefix: '/system-snapshot',
    db: db as never,
    sources: sources as never,
    scraperRuns: scraperRuns as never,
    meili: meili as never,
    cache: cache as never,
    config,
    internalApiSecret: undefined,
  })

  return { app, sources, scraperRuns }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Stubs `fetch` so Loki's `/ready` probe always succeeds (used by tests that don't care about Loki reachability). */
function stubLokiReady(ok = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/ready')) return new Response(null, { status: ok ? 200 : 503 })
    return Response.json({ status: 'success', data: { resultType: 'streams', result: [] } })
  }))
}

describe('GET /', () => {
  it('returns a snapshot with the default 1-hour window', async () => {
    stubLokiReady()
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/system-snapshot' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { window: { minutes: number }; snapshot: { signalAvailability: Record<string, string> } } }
    expect(body.data.window.minutes).toBe(60)
    expect(body.data.snapshot.signalAvailability).toMatchObject({ health: 'available', bullmq: 'available', db: 'available', loki: 'available' })

    await app.close()
  })

  it('clamps windowMinutes above 24h down to 1440', async () => {
    stubLokiReady()
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/system-snapshot?windowMinutes=999999' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { window: { minutes: number } } }
    expect(body.data.window.minutes).toBe(1440)

    await app.close()
  })

  it('reports signalAvailability.loki as unavailable when Loki is unreachable', async () => {
    stubLokiReady(false)
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/system-snapshot' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { snapshot: { signalAvailability: Record<string, string> } } }
    expect(body.data.snapshot.signalAvailability.loki).toBe('unavailable')

    await app.close()
  })

  it('excludes runs that finished outside the requested window', async () => {
    stubLokiReady()
    const now = Date.now()
    const inWindow = new Date(now - 5 * 60_000).toISOString()
    const outOfWindow = new Date(now - 5 * 60 * 60_000).toISOString()

    const { app } = buildTestApp({
      scraperRunRepoOverrides: {
        findRecent: vi.fn(async () => [
          { id: 'run-in', sourceId: 'src-1', startedAt: inWindow, finishedAt: inWindow, success: true, listingsFound: 1, listingsNew: 1, listingsUpdated: 0, errorMessage: null },
          { id: 'run-out', sourceId: 'src-1', startedAt: outOfWindow, finishedAt: outOfWindow, success: true, listingsFound: 1, listingsNew: 1, listingsUpdated: 0, errorMessage: null },
        ]),
      },
    })

    const res = await app.inject({ method: 'GET', url: '/system-snapshot?windowMinutes=60' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { counts: { runs: number } } }
    expect(body.data.counts.runs).toBe(1)

    await app.close()
  })

  it('never includes a planted secret-shaped field from an upstream source row', async () => {
    stubLokiReady()
    const { app } = buildTestApp({
      sourceRepoOverrides: {
        findAll: vi.fn(async () => [
          {
            id: 'src-1',
            name: 'Acme',
            baseUrl: 'https://acme.test',
            status: 'active',
            cronExpression: '0 * * * *',
            lastScrapedAt: null,
            lastFullCrawlAt: null,
            lastObservedAt: null,
            listingCount: 1,
            errorMessage: null,
            // Planted secret-shaped value — must never surface in the response.
            apiSecret: 'sk-live-should-never-leak',
          },
        ]),
      },
    })

    const res = await app.inject({ method: 'GET', url: '/system-snapshot' })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('sk-live-should-never-leak')

    await app.close()
  })
})
