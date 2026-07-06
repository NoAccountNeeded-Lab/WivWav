import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_COOKIE_NAME, createSessionValue } from './session'

// next/headers requires a real Next.js request context; mock cookies()/headers()
// so this runs as a plain unit test. Each test configures the returned values.
let mockCookieValue: string | undefined
let mockRequestHeaders: Record<string, string>

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === SESSION_COOKIE_NAME && mockCookieValue ? { value: mockCookieValue } : undefined),
  })),
  headers: vi.fn(async () => ({
    get: (name: string) => mockRequestHeaders[name.toLowerCase()] ?? null,
  })),
}))

const mockApiFetch = vi.fn()
vi.mock('./api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

vi.mock('./api-url', () => ({
  getServerApiBaseUrl: () => 'http://api.internal:3001',
}))

const { proxyToApi, buildUpstreamPath } = await import('./bff-proxy')

beforeEach(() => {
  process.env['OPS_SESSION_SECRET'] = 'test-session-secret'
  mockCookieValue = undefined
  mockRequestHeaders = {}
  mockApiFetch.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildUpstreamPath', () => {
  it('joins path segments with a leading slash', () => {
    expect(buildUpstreamPath(['admin', 'queues'], '')).toBe('/admin/queues')
  })

  it('preserves the query string', () => {
    expect(buildUpstreamPath(['v1', 'listings'], '?perPage=1')).toBe('/v1/listings?perPage=1')
  })

  it('handles an empty path with a prefix', () => {
    expect(buildUpstreamPath(undefined, '', '/admin/board')).toBe('/admin/board')
  })

  it('appends segments after a fixed prefix', () => {
    expect(buildUpstreamPath(['static', 'app.js'], '', '/admin/board')).toBe('/admin/board/static/app.js')
  })
})

describe('proxyToApi', () => {
  it('rejects when there is no valid session cookie', async () => {
    const request = new Request('http://ops.local/api/bff/admin/queues')
    const response = await proxyToApi(request, '/admin/queues')
    expect(response.status).toBe(401)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('proxies an authenticated GET request to the API and mirrors status/body', async () => {
    mockCookieValue = createSessionValue()
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const request = new Request('http://ops.local/api/bff/admin/queues')
    const response = await proxyToApi(request, '/admin/queues')

    expect(response.status).toBe(200)
    expect(mockApiFetch).toHaveBeenCalledWith(
      'http://api.internal:3001/admin/queues',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('rejects a state-changing request with a mismatched Origin (CSRF guard)', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'https://evil.example.com', host: 'ops.local' }

    const request = new Request('http://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')

    expect(response.status).toBe(403)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('allows a state-changing request when Origin matches the host', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'http://ops.local', host: 'ops.local' }
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }))

    const request = new Request('http://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')

    expect(response.status).toBe(204)
    expect(mockApiFetch).toHaveBeenCalled()
  })

  it('rejects a state-changing request with no Origin header', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = {}

    const request = new Request('http://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')

    expect(response.status).toBe(403)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })
})
