import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import type { HelmSummary } from '@wivwav/types'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { internalOpsHelmSummaryRoutes } from './internal-ops-helm-summary.js'

const SECRET = 'test-internal-secret'

interface Fakes {
  stored?: () => Promise<number>
  active?: () => Promise<number>
  bySource?: () => Promise<Array<{ eligibleActive: number }>>
  indexed?: () => Promise<{ numberOfDocuments: number }>
}

async function buildTestApp(fakes: Fakes = {}) {
  const app = Fastify()
  await app.register(sensible)
  await app.register(
    async (scope) => {
      await adminAuthPlugin(scope, { internalApiSecret: SECRET, nodeEnv: 'production' })
      await scope.register(internalOpsHelmSummaryRoutes, {
        prefix: '/helm-summary',
        listings: {
          countStored: fakes.stored ?? (async () => 0),
          countObservedActive: fakes.active ?? (async () => 0),
          getPublicationCountsBySource: (fakes.bySource ?? (async () => [])) as never,
        },
        meili: { httpRequest: { get: fakes.indexed ?? (async () => ({ numberOfDocuments: 0 })) } } as never,
      })
    },
    { prefix: '/internal/ops' },
  )
  return app
}

const get = (app: Awaited<ReturnType<typeof buildTestApp>>, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
  app.inject({ method: 'GET', url: '/internal/ops/helm-summary', headers })

describe('GET /internal/ops/helm-summary', () => {
  it('rejects requests without the bearer secret', async () => {
    const app = await buildTestApp()
    expect((await get(app, {})).statusCode).toBe(401)
    expect((await get(app, { authorization: 'Bearer wrong' })).statusCode).toBe(401)
  })

  it('reports divergent stored/active/eligible/indexed counts independently', async () => {
    const app = await buildTestApp({
      stored: async () => 1000,
      active: async () => 700,
      bySource: async () => [{ eligibleActive: 300 }, { eligibleActive: 120 }],
      indexed: async () => ({ numberOfDocuments: 380 }),
    })
    const res = await get(app)

    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: HelmSummary }
    expect(data.counts.stored.value).toBe(1000)
    expect(data.counts.active.value).toBe(700)
    expect(data.counts.eligible.value).toBe(420)
    expect(data.counts.indexed.value).toBe(380)
    expect(data.availability).toEqual({ database: 'available', search: 'available' })
    expect(Number.isNaN(Date.parse(data.collectedAt))).toBe(false)
    expect(Number.isNaN(Date.parse(data.counts.stored.collectedAt ?? ''))).toBe(false)
  })

  it('returns true zeros (available) for an empty system', async () => {
    const app = await buildTestApp()
    const { data } = (await get(app)).json() as { data: HelmSummary }

    for (const reading of Object.values(data.counts)) {
      expect(reading).toMatchObject({ value: 0, availability: 'available' })
    }
  })

  it('marks only database readings unavailable when the database fails', async () => {
    const app = await buildTestApp({
      stored: async () => { throw new Error('db down') },
      indexed: async () => ({ numberOfDocuments: 55 }),
      active: async () => 9,
    })
    const { data } = (await get(app)).json() as { data: HelmSummary }

    expect(data.counts.stored).toEqual({ value: null, availability: 'unavailable', collectedAt: null })
    expect(data.counts.active.value).toBe(9)
    expect(data.counts.indexed.value).toBe(55)
    expect(data.availability).toEqual({ database: 'unavailable', search: 'available' })
  })

  it('marks the indexed reading unavailable (not zero) when search fails', async () => {
    const app = await buildTestApp({
      stored: async () => 10,
      active: async () => 8,
      bySource: async () => [{ eligibleActive: 5 }],
      indexed: vi.fn(async () => { throw new Error('meili down') }),
    })
    const res = await get(app)

    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: HelmSummary }
    expect(data.counts.indexed).toEqual({ value: null, availability: 'unavailable', collectedAt: null })
    expect(data.counts.eligible.value).toBe(5)
    expect(data.availability).toEqual({ database: 'available', search: 'unavailable' })
  })

  it('reports both sides unavailable when everything fails', async () => {
    const boom = async (): Promise<never> => { throw new Error('down') }
    const app = await buildTestApp({ stored: boom, active: boom, bySource: boom, indexed: boom })
    const { data } = (await get(app)).json() as { data: HelmSummary }

    expect(Object.values(data.counts).every(r => r.value === null)).toBe(true)
    expect(data.availability).toEqual({ database: 'unavailable', search: 'unavailable' })
  })
})
