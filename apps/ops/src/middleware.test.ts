import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { middleware } from './middleware'
import { SESSION_COOKIE_NAME, createSessionValue } from './lib/session'

beforeEach(() => {
  process.env['OPS_SESSION_SECRET'] = 'test-session-secret'
})

function makeRequest(url: string, init?: { headers?: Record<string, string>; sessionCookie?: string }): NextRequest {
  const request = new NextRequest(url, init?.headers ? { headers: init.headers } : {})
  if (init?.sessionCookie) {
    request.cookies.set(SESSION_COOKIE_NAME, init.sessionCookie)
  }
  return request
}

describe('ops middleware — page protection', () => {
  it('redirects an unauthenticated request for an ops page to /login with a redirect param', () => {
    const response = middleware(makeRequest('http://ops.local/ops/queues'))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('redirect')).toBe('/ops/queues')
  })

  it('passes through an authenticated request', () => {
    const response = middleware(makeRequest('http://ops.local/ops/queues', { sessionCookie: createSessionValue() }))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects the root path when unauthenticated', () => {
    const response = middleware(makeRequest('http://ops.local/status'))
    expect(response.status).toBe(307)
  })
})

describe('ops middleware — BFF and Bull Board API calls', () => {
  it('returns 401 JSON (not a redirect) for unauthenticated /api/bff calls', async () => {
    const response = middleware(makeRequest('http://ops.local/api/bff/admin/queues'))
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns 401 JSON for unauthenticated /admin/board sub-resource fetches', () => {
    const response = middleware(
      makeRequest('http://ops.local/admin/board/static/app.js', { headers: { 'sec-fetch-mode': 'no-cors' } }),
    )
    expect(response.status).toBe(401)
  })

  it('redirects unauthenticated top-level navigation to /admin/board', () => {
    const response = middleware(
      makeRequest('http://ops.local/admin/board', { headers: { 'sec-fetch-mode': 'navigate' } }),
    )
    expect(response.status).toBe(307)
  })

  it('passes through authenticated /api/bff calls', () => {
    const response = middleware(makeRequest('http://ops.local/api/bff/admin/queues', { sessionCookie: createSessionValue() }))
    expect(response.status).toBe(200)
  })
})
