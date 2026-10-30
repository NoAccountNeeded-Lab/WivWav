import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it } from 'vitest'
import { opsAuthPlugin } from '../plugins/ops-auth.js'
import { internalOpsDealerSiteCandidatesRoutes } from './internal-ops-dealer-site-candidates.js'

const SECRET = 'a'.repeat(32)
const auth = { authorization: `Bearer ${SECRET}` }

const rows = [
  { origin: 'https://a.com', status: 'pending_review', _count: { listings: 1 } },
  { origin: 'https://b.com', status: 'pending_review', _count: { listings: 5 } },
  { origin: 'https://c.com', status: 'approved', _count: { listings: 9 } },
]

async function buildApp() {
  // Fake mirrors only the where.status filter, relation-count ordering and take.
  const db = {
    dealerSiteCandidate: {
      findMany: async ({ where, take }: { where: { status?: string }; take: number }) =>
        rows
          .filter((r) => where.status === undefined || r.status === where.status)
          .sort((x, y) => y._count.listings - x._count.listings)
          .slice(0, take),
    },
  }
  const app = Fastify()
  await app.register(sensible)
  await app.register(
    async (scope) => {
      await opsAuthPlugin(scope, { opsApiSecret: SECRET, nodeEnv: 'test' })
      await scope.register(internalOpsDealerSiteCandidatesRoutes, { db: db as never })
    },
    { prefix: '/internal/ops/dealer-site-candidates' },
  )
  await app.ready()
  return app
}

const get = (app: Awaited<ReturnType<typeof buildApp>>, qs = '', headers: Record<string, string> = auth) =>
  app.inject({ method: 'GET', url: `/internal/ops/dealer-site-candidates${qs}`, headers })

describe('GET /internal/ops/dealer-site-candidates', () => {
  it('requires the bearer', async () => {
    const app = await buildApp()
    expect((await get(app, '', {})).statusCode).toBe(401)
  })

  it('returns candidates in the { data } envelope ordered by listingCount desc', async () => {
    const app = await buildApp()
    const res = await get(app)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((r: { origin: string }) => r.origin)).toEqual([
      'https://c.com',
      'https://b.com',
      'https://a.com',
    ])
    expect(res.json().data.map((r: { listingCount: number }) => r.listingCount)).toEqual([9, 5, 1])
    expect(res.json().data[0]).not.toHaveProperty('_count')
  })

  it('filters by status', async () => {
    const app = await buildApp()
    const res = await get(app, '?status=pending_review')
    expect(res.json().data.map((r: { origin: string }) => r.origin)).toEqual(['https://b.com', 'https://a.com'])
  })

  it.each(['?status=bogus', '?limit=0', '?limit=9999', '?limit=x'])('rejects %s with 400', async (qs) => {
    const app = await buildApp()
    expect((await get(app, qs)).statusCode).toBe(400)
  })
})
