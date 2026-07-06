/**
 * FetchErrorMonitor — unit tests for the core patched-fetch logic.
 *
 * FetchErrorMonitor is a React client component that uses useEffect; there is
 * no @testing-library/react available.  We test the pure decision logic
 * (URL normalisation, origin check, API-host allowlist, method derivation,
 * reporting predicate) by duplicating it here — the same pattern used for
 * IntakeForm and PhotoGallery.  Update this file if the implementation changes.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Extracted logic under test (mirrors the patchedFetch closure in useEffect)
// ---------------------------------------------------------------------------

interface MonitoredRequest {
  input: RequestInfo | URL
  init?: RequestInit
  status: number
  origin: string
  host: string
  /** The resolved API host (hostname+port), or null when not configured */
  apiHost?: string | null
}

interface MonitorDecision {
  /** Whether the error should be reported */
  shouldReport: boolean
  /** The normalised path that would be reported (when shouldReport is true) */
  path: string
  /** The uppercased HTTP method */
  method: string
  /** The formatted error message */
  message: string
}

/**
 * Duplicates the decision logic inside patchedFetch — update both if the
 * implementation changes.
 */
function evaluateFetchError(req: MonitoredRequest): MonitorDecision | null {
  if (req.status < 400) return null

  const rawUrl = req.input instanceof Request ? req.input.url : String(req.input)

  let path: string
  try {
    path = new URL(rawUrl, req.origin).pathname
  } catch {
    path = rawUrl
  }

  // Never report the error-reporter endpoint itself
  if (path === '/telemetry/client-events') return null

  const apiHost = req.apiHost ?? null

  const isTracked =
    rawUrl.startsWith('/') ||
    (() => {
      try {
        const requestHost = new URL(rawUrl).host
        return (
          requestHost === req.host ||
          (apiHost !== null && requestHost === apiHost)
        )
      } catch {
        return false
      }
    })()

  if (!isTracked) return null

  const method = (
    req.init?.method ??
    (req.input instanceof Request ? req.input.method : undefined) ??
    'GET'
  ).toUpperCase()

  const message = `${method} ${path} → ${req.status}`

  return { shouldReport: true, path, method, message }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ORIGIN = 'http://localhost:3000'
const HOST = 'localhost:3000'
const API_HOST = 'localhost:3003'

describe('FetchErrorMonitor — status threshold', () => {
  it('does not report 2xx responses', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      status: 200,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).toBeNull()
  })

  it('does not report 3xx responses', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      status: 301,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).toBeNull()
  })

  it('reports 400 responses', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      status: 400,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).not.toBeNull()
    expect(result?.shouldReport).toBe(true)
  })

  it('reports 404 responses', () => {
    const result = evaluateFetchError({
      input: '/v1/listings/999',
      status: 404,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.shouldReport).toBe(true)
  })

  it('reports 500 responses', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.shouldReport).toBe(true)
  })
})

describe('FetchErrorMonitor — error-reporter endpoint exclusion', () => {
  it('skips /telemetry/client-events to prevent recursive loops', () => {
    const result = evaluateFetchError({
      input: '/telemetry/client-events',
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).toBeNull()
  })

  it('skips absolute URL that resolves to /telemetry/client-events path', () => {
    const result = evaluateFetchError({
      input: `${ORIGIN}/telemetry/client-events`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).toBeNull()
  })

  it('skips /telemetry/client-events even when called on the API host', () => {
    // The loop guard fires before the origin check — must hold for cross-origin API too
    const result = evaluateFetchError({
      input: `http://${API_HOST}/telemetry/client-events`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result).toBeNull()
  })
})

describe('FetchErrorMonitor — same-origin detection', () => {
  it('reports relative paths (they are always same-origin)', () => {
    const result = evaluateFetchError({
      input: '/v1/search?q=van',
      status: 404,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.shouldReport).toBe(true)
  })

  it('reports absolute URL on same host+port', () => {
    const result = evaluateFetchError({
      input: `${ORIGIN}/v1/listings`,
      status: 503,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.shouldReport).toBe(true)
  })

  it('skips absolute URL on a different host (e.g. CDN)', () => {
    const result = evaluateFetchError({
      input: 'https://cdn.example.com/asset.js',
      status: 404,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result).toBeNull()
  })

  it('skips cross-origin Meilisearch URL even when API host is configured', () => {
    const result = evaluateFetchError({
      input: 'http://search.internal:7700/indexes/listings/search',
      status: 400,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result).toBeNull()
  })
})

describe('FetchErrorMonitor — API-host allowlist', () => {
  it('reports failed request to API host when it is on a different port', () => {
    const result = evaluateFetchError({
      input: `http://${API_HOST}/v1/listings`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result?.shouldReport).toBe(true)
  })

  it('reports 4xx request to API host', () => {
    const result = evaluateFetchError({
      input: `http://${API_HOST}/v1/listings/999`,
      status: 404,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result?.shouldReport).toBe(true)
    expect(result?.path).toBe('/v1/listings/999')
  })

  it('still skips API-host requests when apiHost is null (not configured)', () => {
    const result = evaluateFetchError({
      input: `http://${API_HOST}/v1/listings`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
      apiHost: null,
    })
    expect(result).toBeNull()
  })

  it('skips other cross-origin hosts that are not the API host', () => {
    const result = evaluateFetchError({
      input: 'https://cdn.example.com/asset.js',
      status: 404,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result).toBeNull()
  })

  it('skips same hostname but different port that is not the API host', () => {
    // e.g. a local Meilisearch on :7700 should still be excluded
    const result = evaluateFetchError({
      input: 'http://localhost:7700/indexes/listings/search',
      status: 400,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result).toBeNull()
  })
})

describe('FetchErrorMonitor — path normalisation', () => {
  it('strips query string from absolute URL', () => {
    const result = evaluateFetchError({
      input: `${ORIGIN}/v1/listings?page=2&limit=20`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.path).toBe('/v1/listings')
  })

  it('preserves path from relative URL', () => {
    const result = evaluateFetchError({
      input: '/v1/vehicles/vin/1HGCM82633A004352',
      status: 404,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.path).toBe('/v1/vehicles/vin/1HGCM82633A004352')
  })

  it('extracts path from a Request object', () => {
    const request = new Request(`${ORIGIN}/v1/listings`, { method: 'GET' })
    const result = evaluateFetchError({
      input: request,
      status: 503,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.path).toBe('/v1/listings')
  })

  it('strips query string from cross-origin API URL', () => {
    const result = evaluateFetchError({
      input: `http://${API_HOST}/v1/listings?page=1`,
      status: 500,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result?.path).toBe('/v1/listings')
  })
})

describe('FetchErrorMonitor — method derivation', () => {
  it('defaults to GET when no method is specified', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.method).toBe('GET')
  })

  it('uppercases the method from init', () => {
    const result = evaluateFetchError({
      input: '/v1/intake',
      init: { method: 'post' },
      status: 422,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.method).toBe('POST')
  })

  it('uses method from Request object when init is absent', () => {
    const request = new Request(`${ORIGIN}/v1/intake`, { method: 'DELETE' })
    const result = evaluateFetchError({
      input: request,
      status: 405,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.method).toBe('DELETE')
  })

  it('init.method takes precedence over Request.method', () => {
    const request = new Request(`${ORIGIN}/v1/intake`, { method: 'GET' })
    const result = evaluateFetchError({
      input: request,
      init: { method: 'PATCH' },
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.method).toBe('PATCH')
  })
})

describe('FetchErrorMonitor — error message format', () => {
  it('formats message as METHOD PATH → STATUS', () => {
    const result = evaluateFetchError({
      input: '/v1/listings',
      init: { method: 'GET' },
      status: 404,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.message).toBe('GET /v1/listings → 404')
  })

  it('formats 500 POST correctly', () => {
    const result = evaluateFetchError({
      input: '/v1/intake',
      init: { method: 'POST' },
      status: 500,
      origin: ORIGIN,
      host: HOST,
    })
    expect(result?.message).toBe('POST /v1/intake → 500')
  })

  it('formats cross-origin API error correctly', () => {
    const result = evaluateFetchError({
      input: `http://${API_HOST}/v1/listings`,
      init: { method: 'GET' },
      status: 503,
      origin: ORIGIN,
      host: HOST,
      apiHost: API_HOST,
    })
    expect(result?.message).toBe('GET /v1/listings → 503')
  })
})
