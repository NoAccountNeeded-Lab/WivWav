import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it } from 'vitest'
import { adminAuthPlugin } from '../plugins/admin-auth.js'
import { internalOpsDealerSiteCandidatesRoutes } from './internal-ops-dealer-site-candidates.js'

const SECRET = 'a'.repeat(32)
const auth = { authorization: `Bearer ${SECRET}` }

const rows = [
  { origin: 'https://a.com', status: 'pending_review', listingCount: 1 },
  { origin: 'https://b.com', status: 'pending_review', listingCount: 5 },
  { origin: 'https://c.com', status: 'approved', listingCount: 9 },
]

async function buildApp() {
  // Fake mirrors only the where.status filter, orderBy listingCount desc and take.
  const db = {
    dealerSiteCandidate: {
      findMany: async ({ where, take }: { where: { status?: string }; take: number }) =>
        rows
          .filter((r) => where.status === undefined || r.status === where.status)
          .sort((x, y) => y.listingCount - x.listingCount)
          .slice(0, take),
    },
  }
  const app = Fastify()
  await app.register(sensible)
  await app.register(
    async (scope) => {
      await adminAuthPlugin(scope, { internalApiSecret: SECRET, nodeEnv: 'test' })
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
