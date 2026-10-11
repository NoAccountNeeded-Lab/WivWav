import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { WorkerRegistry, newWorkerStats } from '../worker-gateway/registry.js'
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
        successRate: null, avgDurationMs: null, jobsPerMinute: null, statsSince: null, queues: [],
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
        },
      ])
    expect(res.body).not.toContain('connectionId')

    registry.unregister('conn-1')
    const after = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(after.json().data).toEqual([])
    await app.close()
  })

  it('aggregates fleet totals and per-queue rows; escalations are not failures', async () => {
    const registry = new WorkerRegistry()
    const stats = newWorkerStats(new Date(Date.now() - 10 * 60_000))
    stats.completed = 8
    stats.failed = 2
    stats.escalated = 5
    stats.totalDurationMs = 20_000
    stats.queues.set('source-scrape', { completed: 8, failed: 2, totalDurationMs: 20_000 })
    registry.register(worker({ stats }))
    const app = await buildApp(registry)
    const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    const { summary } = res.json()
    expect(summary).toMatchObject({
      workers: 1, busyWorkers: 1, inFlight: 2, capacity: 3,
      completed: 8, failed: 2, escalated: 5, successRate: 0.8, avgDurationMs: 2000,
    })
    expect(summary.jobsPerMinute).toBeCloseTo(1, 1)
    expect(summary.queues).toEqual([
      { queueName: 'source-scrape', running: 1, completed: 8, failed: 2, avgDurationMs: 2000 },
      { queueName: 'detail-crawl', running: 1, completed: 0, failed: 0, avgDurationMs: null },
    ])
    await app.close()
  })
})
