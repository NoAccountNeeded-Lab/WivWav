import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { WorkerRegistry, newWorkerStats, recordOutcome } from '../worker-gateway/registry.js'
import type { RegisteredWorker } from '../worker-gateway/registry.js'
import { adminWorkersRoutes } from './admin-workers.js'

const SECRET = 'a'.repeat(32)

async function buildApp(registry: WorkerRegistry) {
  const app = Fastify()
  await app.register(
    async (scope) => {
      await adminAuthPlugin(scope, { internalApiSecret: SECRET, nodeEnv: 'test' })
      await scope.register(adminWorkersRoutes, { registry })
    },
    { prefix: '/admin/workers' },
  )
  await app.ready()
  return app
}

function worker(overrides: Partial<RegisteredWorker> = {}): RegisteredWorker {
  return {
    connectionId: 'conn-1',
    workerId: 'worker-1',
    workerName: 'Desk laptop',
    capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 3 },
    inFlight: new Set(['c1', 'c2']),
    jobs: new Map([
      ['c1', { queueName: 'detail-crawl', dispatchedAt: new Date('2026-10-03T12:01:00.000Z') }],
      ['c2', { queueName: 'source-scrape', dispatchedAt: new Date('2026-10-03T12:02:00.000Z') }],
    ]),
    recentJobs: [
      {
        queueName: 'source-scrape',
        correlationId: 'c0',
        success: false,
        errorMessage: 'worker reported failure',
        finishedAt: new Date('2026-10-03T11:59:00.000Z'),
      },
    ],
    stats: newWorkerStats(new Date('2026-10-03T11:00:00.000Z')),
    lastHeartbeatAt: new Date('2026-10-03T12:00:00.000Z'),
    send: vi.fn(),
    ...overrides,
  }
}

const auth = { authorization: `Bearer ${SECRET}` }

describe('GET /admin/workers', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const app = await buildApp(new WorkerRegistry())
    const res = await app.inject({ method: 'GET', url: '/admin/workers' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns an empty list when no worker is connected', async () => {
    const app = await buildApp(new WorkerRegistry())
    const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: [],
      summary: {
        workers: 0, busyWorkers: 0, inFlight: 0, capacity: 0, completed: 0, failed: 0, escalated: 0,
        successRate: null, avgDurationMs: null, jobsPerMinute: expect.any(Number), statsSince: expect.any(String), queues: [],
      },
    })
    await app.close()
  })

  it('maps connected workers to a plain shape and drops them on unregister', async () => {
    const registry = new WorkerRegistry()
    registry.register(worker())
    const app = await buildApp(registry)

    const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(res.json().data).toEqual([
        {
          connectionId: 'conn-1',
          accepting: true,
          workerId: 'worker-1',
          workerName: 'Desk laptop',
          capabilities: { chromium: true, httpEnrich: false, maxConcurrentJobs: 3 },
          inFlightCount: 2,
          inFlightJobs: [
            {
              queueName: 'detail-crawl',
              correlationId: 'c1',
              dispatchedAt: '2026-10-03T12:01:00.000Z',
            },
            {
              queueName: 'source-scrape',
              correlationId: 'c2',
              dispatchedAt: '2026-10-03T12:02:00.000Z',
            },
          ],
          recentJobs: [
            {
              queueName: 'source-scrape',
              correlationId: 'c0',
              success: false,
              errorMessage: 'worker reported failure',
              finishedAt: '2026-10-03T11:59:00.000Z',
            },
          ],
          lastHeartbeatAt: '2026-10-03T12:00:00.000Z',
          connectedAt: '2026-10-03T11:00:00.000Z',
          completed: 0,
          failed: 0,
          escalated: 0,
          totalDurationMs: 0,
          timed: 0,
        },
      ])

    registry.unregister('conn-1')
    const after = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(after.json().data).toEqual([])
    await app.close()
  })

  it('summarises fleet totals from the registry, surviving worker disconnect; escalations are not failures', async () => {
    const registry = new WorkerRegistry()
    registry.startedAt.setTime(Date.now() - 10 * 60_000)
    recordOutcome(registry.fleet, 'source-scrape', 'completed', 1000)
    for (let i = 0; i < 7; i++) recordOutcome(registry.fleet, 'source-scrape', 'completed', 2000)
    recordOutcome(registry.fleet, 'source-scrape', 'failed', 5000)
    recordOutcome(registry.fleet, 'source-scrape', 'failed', undefined) // untimed: not in the divisor
    for (let i = 0; i < 5; i++) recordOutcome(registry.fleet, 'source-scrape', 'escalated', 9999)
    registry.register(worker())
    const app = await buildApp(registry)
    const get = async () => (await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })).json().summary
    const summary = await get()
    expect(summary).toMatchObject({
      workers: 1, busyWorkers: 1, inFlight: 2, capacity: 3,
      completed: 8, failed: 2, escalated: 5, successRate: 0.8,
    })
    expect(summary.avgDurationMs).toBeCloseTo(20_000 / 9, 3) // 9 timed jobs, the untimed one is excluded
    expect(summary.jobsPerMinute).toBeCloseTo(1, 1)
    expect(summary.statsSince).toBe(registry.startedAt.toISOString())
    expect(summary.queues).toEqual([
      { queueName: 'source-scrape', running: 1, completed: 8, failed: 2, avgDurationMs: 20_000 / 9 },
      { queueName: 'detail-crawl', running: 1, completed: 0, failed: 0, avgDurationMs: null },
    ])
    registry.unregister('conn-1')
    expect(await get()).toMatchObject({ workers: 0, completed: 8, failed: 2 })
    await app.close()
  })
})

describe('POST /internal/ops/workers/:connectionId/{pause,resume} (#1151)', () => {
  async function build(registry: WorkerRegistry) {
    const { internalOpsWorkerControlRoutes } = await import('./internal-ops-worker-control.js')
    const app = Fastify()
    await app.register(
      async (scope) => {
        await adminAuthPlugin(scope, { internalApiSecret: SECRET, nodeEnv: 'test' })
        await scope.register(internalOpsWorkerControlRoutes, { registry })
      },
      { prefix: '/internal/ops/workers' },
    )
    await app.ready()
    return app
  }

  it('pauses then resumes, reflected on the registry', async () => {
    const registry = new WorkerRegistry()
    registry.register(worker())
    const app = await build(registry)
    const pause = await app.inject({ method: 'POST', url: '/internal/ops/workers/conn-1/pause', headers: auth })
    expect(pause.statusCode).toBe(200)
    expect(pause.json()).toEqual({ data: { connectionId: 'conn-1', accepting: false } })
    expect(registry.pickWorker({ chromium: false })).toBeUndefined()
    const resume = await app.inject({ method: 'POST', url: '/internal/ops/workers/conn-1/resume', headers: auth })
    expect(resume.json()).toEqual({ data: { connectionId: 'conn-1', accepting: true } })
    expect(registry.pickWorker({ chromium: false })?.connectionId).toBe('conn-1')
    await app.close()
  })

  it('returns 404 for a stale connectionId', async () => {
    const app = await build(new WorkerRegistry())
    const res = await app.inject({ method: 'POST', url: '/internal/ops/workers/gone/pause', headers: auth })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    await app.close()
  })

  it('rejects missing or wrong bearer with 401', async () => {
    const app = await build(new WorkerRegistry())
    for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
      const res = await app.inject({ method: 'POST', url: '/internal/ops/workers/conn-1/pause', headers })
      expect(res.statusCode).toBe(401)
    }
    await app.close()
  })

  it('GET exposes connectionId and accepting', async () => {
    const registry = new WorkerRegistry()
    registry.register(worker())
    registry.setAccepting('conn-1', false)
    const app = await buildApp(registry)
    const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(res.json().data[0]).toMatchObject({ connectionId: 'conn-1', accepting: false })
    await app.close()
  })
})
