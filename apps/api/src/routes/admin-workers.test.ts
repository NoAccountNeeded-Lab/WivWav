import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { WorkerRegistry } from '../worker-gateway/registry.js'
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
    expect(res.json()).toEqual({ data: [] })
    await app.close()
  })

  it('maps connected workers to a plain shape and drops them on unregister', async () => {
    const registry = new WorkerRegistry()
    registry.register(worker())
    const app = await buildApp(registry)

    const res = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(res.json()).toEqual({
      data: [
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
        },
      ],
    })
    expect(res.body).not.toContain('connectionId')

    registry.unregister('conn-1')
    const after = await app.inject({ method: 'GET', url: '/admin/workers', headers: auth })
    expect(after.json()).toEqual({ data: [] })
    await app.close()
  })
})
