import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

async function loadPost(dsn = 'https://public@example@o123.ingest.sentry.io/456') {
  vi.stubEnv('SENTRY_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn)
  const route = await import('./route')
  return route.POST
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: 'sentry-envelope-body',
  })
}

describe('POST /api/monitoring', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns 404 by default when Sentry is disabled', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example@o123.ingest.sentry.io/456')
    const { POST } = await import('./route')

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('forwards Sentry envelopes to the SaaS ingest endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://o123.ingest.sentry.io/api/456/envelope/?hsts=0',
      expect.objectContaining({
        method: 'POST',
        body: 'sentry-envelope-body',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
      }),
    )
  })

  it('forwards regional Sentry envelopes to the regional ingest endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456&r=de'))

    expect(res.status).toBe(202)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://o123.ingest.de.sentry.io/api/456/envelope/?hsts=0',
      expect.any(Object),
    )
  })

  it('returns 400 when org id is non-numeric', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=abc&p=456'))

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when project id is missing', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123'))

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when region is not exactly two lowercase letters', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456&r=USA'))

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('passes through upstream Sentry status codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })))
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(429)
  })

  it('returns 400 when the request org does not match the configured DSN org', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=999&p=456'))

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when no configured DSN is available', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost('')

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 413 when content-length header exceeds 512 KB', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const req = new NextRequest('http://localhost/api/monitoring?o=123&p=456', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'content-length': String(512 * 1024 + 1),
      },
      body: 'small',
    })

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('returns 413 when body byte length exceeds 512 KB even without content-length header', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    // Build a body that exceeds 512 KB
    const oversizedBody = 'x'.repeat(512 * 1024 + 1)
    const req = new NextRequest('http://localhost/api/monitoring?o=123&p=456', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: oversizedBody,
    })

    const res = await POST(req)

    expect(res.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('passes the request content-type header through to upstream', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const req = new NextRequest('http://localhost/api/monitoring?o=123&p=456', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope; charset=utf-8' },
      body: 'payload',
    })

    await POST(req)

    const [, fetchOptions] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((fetchOptions.headers as Record<string, string>)?.['Content-Type']).toBe(
      'application/x-sentry-envelope; charset=utf-8',
    )
  })

  it('uses the us region when region param is "us"', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456&r=us'))

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://o123.ingest.us.sentry.io/api/456/envelope/?hsts=0',
      expect.any(Object),
    )
  })

  it('returns 502 when the upstream Sentry fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(502)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BAD_GATEWAY')
    expect(body.error.message).toBe('Sentry ingest unreachable')
  })

  it('forwards the Retry-After header when upstream includes it', async () => {
    const upstreamResponse = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse))
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('does not set Retry-After header when upstream omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const POST = await loadPost()

    const res = await POST(makeRequest('/api/monitoring?o=123&p=456'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})
