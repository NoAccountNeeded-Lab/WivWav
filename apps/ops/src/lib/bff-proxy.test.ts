import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    ['GET', '/admin/workers'], ['GET', '/admin/config'], ['GET', '/admin/config/ollama%2Fmodel'], ['GET', '/admin/config/ollama%2Fmodel/history'],
    ['GET', '/admin/ai/status'], ['GET', '/admin/logs?limit=50'], ['GET', '/admin/field-conflicts'],
    ['GET', '/admin/api-keys'],
    ['GET', '/admin/private-seller-retention/listings/listing-1/audit'], ['GET', '/admin/board/static/app.js'],
    ['POST', '/admin/queues/detail-crawl/pause'], ['POST', '/admin/queues/detail-crawl/jobs'],
    ['POST', '/admin/sync'], ['POST', '/admin/sources/source-1/run'], ['POST', '/admin/ai/explain-error'],
    ['POST', '/admin/api-keys'],
    ['POST', '/admin/private-seller-retention/listings/listing-1/delete'], ['POST', '/internal/ops/workers/conn-1/pause'],
    ['POST', '/internal/ops/queues/detail-crawl/jobs/1/retry'], ['POST', '/internal/ops/problem-ack'],
    ['POST', '/internal/ops/problem-aggregate'],
    ['POST', '/internal/ops/listings/listing-1/actions'], ['PUT', '/admin/config/ollama%2Fmodel'],
    ['PUT', '/admin/repeatables/detail-crawl'], ['DELETE', '/admin/config/ollama%2Fmodel'],
    ['DELETE', '/admin/repeatables/detail-crawl'], ['DELETE', '/admin/queues/detail-crawl/failed'],
    ['DELETE', '/admin/api-keys/key-1'],
    ['POST', '/admin/board/api/queues/detail-crawl/add'],
    ['PUT', '/admin/board/api/queues/pause'], ['PUT', '/admin/board/api/queues/detail-crawl/retry/failed'],
    ['PUT', '/admin/board/api/queues/detail-crawl/clean/completed'], ['PUT', '/admin/board/api/queues/detail-crawl/promote'],
    ['PUT', '/admin/board/api/queues/detail-crawl/pause'], ['PUT', '/admin/board/api/queues/detail-crawl/rate-limit/release'],
    ['PUT', '/admin/board/api/queues/detail-crawl/job-schedulers/scheduler-1/remove'],
    ['PUT', '/admin/board/api/queues/detail-crawl/job-1/retry'], ['PUT', '/admin/board/api/queues/detail-crawl/job-1/clean'],
    ['PUT', '/admin/board/api/queues/detail-crawl/job-1/promote'],
    ['PATCH', '/admin/board/api/queues/detail-crawl/job-schedulers/scheduler-1'],
    ['PATCH', '/admin/board/api/queues/detail-crawl/job-1/update-data'],
  ])('allows current ops call site %s %s', (method, path) => {
    expect(isAllowedBffRequest(method, path)).toBe(true)
  })

  it.each([
    ['GET', '/admin/api-keys/key-1'],
    ['POST', '/admin/api-keys/key-1'],
    ['DELETE', '/admin/api-keys'],
    ['DELETE', '/admin/api-keys/key-1/extra'],
    ['POST', '/internal/v1/api-keys'],
  ])('rejects API key management paths outside the narrow allowlist: %s %s', (method, path) => {
    expect(isAllowedBffRequest(method, path)).toBe(false)
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

  it('reports a distinct server configuration error when OPS_PUBLIC_ORIGIN is missing or malformed', async () => {
    mockCookieValue = createSessionValue()
    mockRequestHeaders = { origin: 'https://ops.local' }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const value of [undefined, 'not-an-origin', 'https://ops.local/path']) {
      if (value === undefined) delete process.env['OPS_PUBLIC_ORIGIN']
      else process.env['OPS_PUBLIC_ORIGIN'] = value
      const response = await proxyToApi(new Request('https://ops.local/api/bff/admin/sync', { method: 'POST' }), '/admin/sync')
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: { code: 'OPS_PUBLIC_ORIGIN_MISCONFIGURED', message: 'OPS_PUBLIC_ORIGIN must be set to the public ops scheme and host' },
      })
    }
    expect(errorSpy).toHaveBeenCalledTimes(3)
    errorSpy.mockRestore()
  })

  it('keeps every browser API call site in the BFF allowlist', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const files: string[] = []
    function collect(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) collect(path)
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) files.push(path)
      }
    }
    collect(srcRoot)

    const callSites: Array<{ file: string; method: string; path: string }> = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const pattern = /\$\{(?:apiBaseUrl|getPublicApiBaseUrl\(\))\}([^`\\]*)/g
      for (const match of source.matchAll(pattern)) {
        const templateTail = match[1] ?? ''
        if (!templateTail.startsWith('/')) continue
        const rawPath = templateTail.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'value')
        const context = source.slice(match.index, match.index + 600)
        const before = source.slice(Math.max(0, (match.index ?? 0) - 100), match.index)
        const method = context.match(/method:\s*['"]([A-Z]+)['"]/)?.[1]
          ?? (/postJson(?:<[^>]+>)?\(/.test(before) ? 'POST' : 'GET')
        callSites.push({ file, method, path: rawPath })
      }
    }

    expect(callSites.length).toBeGreaterThan(0)
    const enumValues = ['cancel', 'retry', 'make-ready', 'enable', 'disable', 'pause', 'resume']
    const isAllowedCallSite = (callSite: typeof callSites[number]): boolean => {
      if (isAllowedBffRequest(callSite.method, callSite.path)) return true
      return enumValues.some(value => isAllowedBffRequest(callSite.method, callSite.path.replace(/\/value$/, `/${value}`)))
    }
    expect(callSites.filter(callSite => !isAllowedCallSite(callSite))).toEqual([])
  })
})
