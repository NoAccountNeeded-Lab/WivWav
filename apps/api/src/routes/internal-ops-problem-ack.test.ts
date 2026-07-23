import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { internalOpsProblemAckRoutes } from './internal-ops-problem-ack.js'
import type { OpsProblemStateRepository, OpsProblemStateRow } from '../repositories/index.js'

const ROW: OpsProblemStateRow = {
  fingerprint: 'domain:source:stale',
  source: 'domain',
  firstSeenAt: new Date('2026-07-22T09:00:00.000Z'),
  lastSeenAt: new Date('2026-07-22T10:00:00.000Z'),
  occurrenceCount: 2,
  acknowledgedAt: new Date('2026-07-23T09:00:00.000Z'),
  acknowledgedBy: 'ops@example.com',
}

function buildTestApp(problemStates: OpsProblemStateRepository) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(internalOpsProblemAckRoutes, { problemStates })
  return app
}

describe('POST /', () => {
  it('acknowledges a problem fingerprint', async () => {
    const setAcknowledgement = vi.fn(async () => ROW)
    const app = buildTestApp({ setAcknowledgement, recordPass: vi.fn(async () => []) })

    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: {
        fingerprint: 'domain:source:stale',
        acknowledged: true,
        acknowledgedBy: 'ops@example.com',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        ...ROW,
        firstSeenAt: ROW.firstSeenAt.toISOString(),
        lastSeenAt: ROW.lastSeenAt.toISOString(),
        acknowledgedAt: ROW.acknowledgedAt?.toISOString(),
      },
    })
    expect(setAcknowledgement).toHaveBeenCalledWith({
      fingerprint: 'domain:source:stale',
      acknowledged: true,
      acknowledgedBy: 'ops@example.com',
    })

    await app.close()
  })

  it('unacknowledges a problem fingerprint', async () => {
    const unacknowledged = { ...ROW, acknowledgedAt: null, acknowledgedBy: null }
    const setAcknowledgement = vi.fn(async () => unacknowledged)
    const app = buildTestApp({ setAcknowledgement, recordPass: vi.fn(async () => []) })

    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: {
        fingerprint: 'domain:source:stale',
        acknowledged: false,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(setAcknowledgement).toHaveBeenCalledWith({
      fingerprint: 'domain:source:stale',
      acknowledged: false,
      acknowledgedBy: null,
    })

    await app.close()
  })

  it('returns 404 when the fingerprint has never been persisted', async () => {
    const app = buildTestApp({
      setAcknowledgement: vi.fn(async () => null),
      recordPass: vi.fn(async () => []),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: { fingerprint: 'missing', acknowledged: true },
    })

    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('rejects invalid acknowledgement bodies', async () => {
    const app = buildTestApp({
      setAcknowledgement: vi.fn(async () => null),
      recordPass: vi.fn(async () => []),
    })

    await expect(app.inject({ method: 'POST', url: '/', payload: { acknowledged: true } }))
      .resolves.toMatchObject({ statusCode: 400 })
    await expect(app.inject({ method: 'POST', url: '/', payload: { fingerprint: 'x', acknowledged: 'yes' } }))
      .resolves.toMatchObject({ statusCode: 400 })

    await app.close()
  })
})
