import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it } from 'vitest'
import { adminAttentionRoutes } from './admin-attention.js'

function buildTestApp() {
  const app = Fastify()
  void app.register(sensible)
  void app.register(adminAttentionRoutes)
  return app
}

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

describe('POST /', () => {
  it('computes an attention snapshot from posted resource state', async () => {
    const app = buildTestApp()
    const res = await app.inject({ method: 'POST', url: '/', payload: validBody() })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { conditions: unknown[]; signalAvailability: Record<string, string> } }
    expect(body.data.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'queue_failed_jobs' }),
    ]))
    expect(body.data.signalAvailability).toEqual({ health: 'available', bullmq: 'available', db: 'available', loki: 'available' })
  })

  it('reports unavailable signals independently instead of failing', async () => {
    const app = buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: validBody({ health: { data: null, unavailable: true }, sources: { data: null, unavailable: true } }),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: { signalAvailability: Record<string, string> } }
    expect(body.data.signalAvailability.health).toBe('unavailable')
    expect(body.data.signalAvailability.db).toBe('unavailable')
    expect(body.data.signalAvailability.bullmq).toBe('available')
  })

  it('rejects a body missing the now timestamp', async () => {
    const app = buildTestApp()
    const { now: _now, ...rest } = validBody()
    const res = await app.inject({ method: 'POST', url: '/', payload: rest })

    expect(res.statusCode).toBe(400)
  })

  it('rejects a body missing a resource input', async () => {
    const app = buildTestApp()
    const { queues: _queues, ...rest } = validBody()
    const res = await app.inject({ method: 'POST', url: '/', payload: rest })

    expect(res.statusCode).toBe(400)
  })
})
