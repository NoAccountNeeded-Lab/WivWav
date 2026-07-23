import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminSentryIssuesRoutes } from './admin-sentry-issues.js'

function buildTestApp(options: { sentryAuthToken?: string; sentryOrg?: string; sentryProject?: string } = {}) {
  const app = Fastify()
  void app.register(adminSentryIssuesRoutes, {
    sentryAuthToken: options.sentryAuthToken,
    sentryOrg: options.sentryOrg,
    sentryProject: options.sentryProject,
  })
  return app
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GET /', () => {
  it('returns normalised issue summaries when credentials are configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      {
        id: 'sentry-1',
        title: 'TypeError: x is not a function',
        culprit: 'apps/api/src/routes/listings.ts',
        level: 'error',
        count: '42',
        firstSeen: '2026-06-10T00:00:00.000Z',
        lastSeen: '2026-06-18T17:00:00.000Z',
        permalink: 'https://sentry.io/issues/sentry-1',
      },
    ])))

    const app = buildTestApp({ sentryAuthToken: 'tok', sentryOrg: 'wivwav', sentryProject: 'api' })
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: { issues: unknown[]; unavailable: boolean } }
    expect(data.unavailable).toBe(false)
    expect(data.issues).toEqual([
      {
        id: 'sentry-1',
        title: 'TypeError: x is not a function',
        culprit: 'apps/api/src/routes/listings.ts',
        level: 'error',
        count: 42,
        firstSeen: '2026-06-10T00:00:00.000Z',
        lastSeen: '2026-06-18T17:00:00.000Z',
        permalink: 'https://sentry.io/issues/sentry-1',
      },
    ])
  })

  it('returns unavailable:true without attempting a fetch when credentials are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { issues: [], unavailable: true } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns unavailable:true with an empty list instead of throwing when Sentry is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ETIMEDOUT')
    }))

    const app = buildTestApp({ sentryAuthToken: 'tok', sentryOrg: 'wivwav', sentryProject: 'api' })
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { issues: [], unavailable: true } })
  })

  it('returns unavailable:true when Sentry responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))

    const app = buildTestApp({ sentryAuthToken: 'tok', sentryOrg: 'wivwav', sentryProject: 'api' })
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { issues: [], unavailable: true } })
  })

  it('returns unavailable:true instead of throwing when Sentry returns a malformed (non-array) body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: 'not an array' })))

    const app = buildTestApp({ sentryAuthToken: 'tok', sentryOrg: 'wivwav', sentryProject: 'api' })
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { issues: [], unavailable: true } })
  })
})
