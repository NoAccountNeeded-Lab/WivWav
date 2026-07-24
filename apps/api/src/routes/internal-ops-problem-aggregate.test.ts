import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { internalOpsProblemAggregateRoutes } from './internal-ops-problem-aggregate.js'
import type { OpsProblemStateRepository, OpsProblemStateRow } from '../repositories/index.js'

const NOW = '2026-06-18T18:00:00.000Z'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    now: NOW,
    health: { data: null, unavailable: false },
    queues: {
      data: [{ name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 1, delayed: 0 } }],
      unavailable: false,
    },
    sources: { data: null, unavailable: false },
    runs: { data: null, unavailable: false },
    schedules: { data: null, unavailable: false },
    ...overrides,
  }
}

function buildTestApp(problemStates: OpsProblemStateRepository) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(internalOpsProblemAggregateRoutes, {
    problemStates,
    grafanaUrl: 'http://grafana.test',
    grafanaApiToken: undefined,
    sentryAuthToken: undefined,
    sentryOrg: undefined,
    sentryProject: undefined,
  })
  return app
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /', () => {
  it('federates domain problems, persists a pass, and merges lifecycle/ack state back in', async () => {
    const row: OpsProblemStateRow = {
      fingerprint: 'domain:queue_failed_jobs:queue:*',
      source: 'domain',
      firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
      lastSeenAt: new Date(NOW),
      occurrenceCount: 5,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }
    const recordPass = vi.fn(async () => [row])
    const app = buildTestApp({ recordPass, setAcknowledgement: vi.fn() })

    const res = await app.inject({ method: 'POST', url: '/', payload: validBody() })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { problems: Array<Record<string, unknown>>; availability: Record<string, string> } }

    // The geocode queue's own `failed: 1` also trips `geocode_failed` — only
    // the fingerprint this test cares about (`queue_failed_jobs`) is asserted
    // here via `arrayContaining` rather than an exact list.
    expect(recordPass).toHaveBeenCalledWith(
      expect.arrayContaining([{ fingerprint: 'domain:queue_failed_jobs:queue:*', source: 'domain' }]),
      new Date(NOW),
    )
    expect(body.data.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fingerprint: 'domain:queue_failed_jobs:queue:*',
        firstSeen: '2026-06-01T00:00:00.000Z',
        lastSeen: NOW,
        occurrenceCount: 5,
        acknowledgedAt: null,
        acknowledgedBy: null,
      }),
    ]))
    expect(body.data.availability).toEqual({
      health: 'available',
      bullmq: 'available',
      db: 'available',
      loki: 'available',
      grafana: 'unavailable',
      sentry: 'unavailable',
    })

    await app.close()
  })

  it('carries acknowledgement state from the persisted row into the response', async () => {
    const row: OpsProblemStateRow = {
      fingerprint: 'domain:queue_failed_jobs:queue:*',
      source: 'domain',
      firstSeenAt: new Date('2026-06-01T00:00:00.000Z'),
      lastSeenAt: new Date(NOW),
      occurrenceCount: 5,
      acknowledgedAt: new Date('2026-06-15T00:00:00.000Z'),
      acknowledgedBy: 'ops@example.com',
    }
    const app = buildTestApp({ recordPass: vi.fn(async () => [row]), setAcknowledgement: vi.fn() })

    const res = await app.inject({ method: 'POST', url: '/', payload: validBody() })

    const body = res.json() as { data: { problems: Array<Record<string, unknown>> } }
    expect(body.data.problems[0]).toMatchObject({
      acknowledgedAt: '2026-06-15T00:00:00.000Z',
      acknowledgedBy: 'ops@example.com',
    })

    await app.close()
  })

  it('rejects a body missing the now timestamp', async () => {
    const app = buildTestApp({ recordPass: vi.fn(async () => []), setAcknowledgement: vi.fn() })
    const payload: Record<string, unknown> = validBody()
    delete payload.now

    const res = await app.inject({ method: 'POST', url: '/', payload })
    expect(res.statusCode).toBe(400)

    await app.close()
  })

  it('rejects a body missing a resource input', async () => {
    const app = buildTestApp({ recordPass: vi.fn(async () => []), setAcknowledgement: vi.fn() })
    const payload: Record<string, unknown> = validBody()
    delete payload.sources

    const res = await app.inject({ method: 'POST', url: '/', payload })
    expect(res.statusCode).toBe(400)

    await app.close()
  })

  it('never persists problems for an empty aggregate', async () => {
    const recordPass = vi.fn(async () => [])
    const app = buildTestApp({ recordPass, setAcknowledgement: vi.fn() })

    const res = await app.inject({ method: 'POST', url: '/', payload: validBody({ queues: { data: null, unavailable: false } }) })

    expect(res.statusCode).toBe(200)
    expect(recordPass).toHaveBeenCalledWith([], new Date(NOW))
    const body = res.json() as { data: { problems: unknown[] } }
    expect(body.data.problems).toEqual([])

    await app.close()
  })

  it('fetches Grafana and Sentry themselves rather than requiring the caller to supply that state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('grafana.test')) {
        return Response.json([
          { labels: { alertname: 'API down', __alert_rule_uid__: 'wivwav-api-down', severity: 'critical' }, annotations: {}, status: { state: 'active' }, startsAt: NOW },
        ])
      }
      throw new Error('unexpected fetch')
    }))

    const app = buildTestApp({ recordPass: vi.fn(async () => []), setAcknowledgement: vi.fn() })
    const res = await app.inject({ method: 'POST', url: '/', payload: validBody({ queues: { data: null, unavailable: false } }) })

    const body = res.json() as { data: { problems: Array<Record<string, unknown>>; availability: Record<string, string> } }
    expect(body.data.availability.grafana).toBe('available')
    expect(body.data.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'grafana', fingerprint: 'grafana:wivwav-api-down' }),
    ]))

    await app.close()
  })
})
