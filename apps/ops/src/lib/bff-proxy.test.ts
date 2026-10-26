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

const { BFF_ALLOWLIST, isAllowedBffRequest, proxyToApi, buildUpstreamPath } = await import('./bff-proxy')

beforeEach(() => {
  process.env['OPS_SESSION_SECRET'] = 'test-session-secret'
  process.env['OPS_PUBLIC_ORIGIN'] = 'https://ops.local'
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
  it.each([
    ['GET', '/health'], ['GET', '/v1/listings?perPage=1'], ['GET', '/admin/queues'],
    ['GET', '/admin/queues/detail-crawl'], ['GET', '/admin/sources/source-1/pipeline'],
    ['GET', '/admin/sources/source-1/job-runs'], ['GET', '/admin/runs'], ['GET', '/admin/repeatables'],
    ['GET', '/admin/workers'], ['GET', '/admin/config'], ['GET', '/admin/config/ollama%2Fmodel'],
    ['GET', '/admin/ai/status'], ['GET', '/admin/logs?limit=50'], ['GET', '/admin/field-conflicts'],
    ['GET', '/admin/private-seller-retention/listings/listing-1/audit'], ['GET', '/admin/board/static/app.js'],
    ['POST', '/admin/queues/detail-crawl/pause'], ['POST', '/admin/queues/detail-crawl/jobs'],
    ['POST', '/admin/sync'], ['POST', '/admin/sources/source-1/run'], ['POST', '/admin/ai/explain-error'],
    ['POST', '/admin/private-seller-retention/listings/listing-1/delete'], ['POST', '/internal/ops/workers/conn-1/pause'],
    ['POST', '/internal/ops/queues/detail-crawl/jobs/1/retry'], ['POST', '/internal/ops/problem-ack'],
    ['POST', '/internal/ops/listings/listing-1/actions'], ['PUT', '/admin/config/ollama%2Fmodel'],
    ['PUT', '/admin/repeatables/detail-crawl'], ['DELETE', '/admin/config/ollama%2Fmodel'],
    ['DELETE', '/admin/repeatables/detail-crawl'], ['DELETE', '/admin/queues/detail-crawl/failed'],
  ])('allows current ops call site %s %s', (method, path) => {
    expect(isAllowedBffRequest(method, path)).toBe(true)
  })

  it('has a method and path rule for every allowlist entry', () => {
    expect(BFF_ALLOWLIST.every(rule => rule.method && rule.path instanceof RegExp)).toBe(true)
  })

  it('rejects an unlisted path and method before forwarding', async () => {
    mockCookieValue = createSessionValue()
    const request = new Request('https://ops.local/api/bff/admin/secrets', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/secrets')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN_PATH', message: 'BFF path or method is not allowed' } })
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

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

  it('allows a state-changing request when Origin matches the configured public origin', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'https://ops.local', host: 'ops.local' }
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }))

    const request = new Request('https://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')

    expect(response.status).toBe(204)
    expect(mockApiFetch).toHaveBeenCalled()
  })

  it('rejects a scheme-mismatched Origin', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'http://ops.local', host: 'ops.local' }
    const request = new Request('https://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')
    expect(response.status).toBe(403)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('rejects a foreign Origin even when its host header matches', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'https://evil.example', host: 'ops.local' }
    const request = new Request('https://ops.local/api/bff/admin/sync', { method: 'POST' })
    const response = await proxyToApi(request, '/admin/sync')
    expect(response.status).toBe(403)
    expect(mockApiFetch).not.toHaveBeenCalled()
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
