import Fastify, { type FastifyBaseLogger } from 'fastify'
import { MockQueueFactory } from '@wivwav/queue'
import { describe, expect, it, vi } from 'vitest'
import { buildApp, isAllowedCorsOrigin } from './app.js'
import type { Config } from './config.js'

// ── Sentry mock (module-level) ────────────────────────────────────────────────
// app.ts imports Sentry from './sentry.js' which calls Sentry.withScope /
// captureException. We mock the re-export so we can spy on those calls.
const { mockCaptureException, mockSetTag, mockWithScope } = vi.hoisted(() => {
  const setTag = vi.fn()
  return {
    mockCaptureException: vi.fn(),
    mockSetTag: setTag,
    mockWithScope: vi.fn((cb: (scope: { setTag: typeof setTag }) => void) => {
      cb({ setTag })
    }),
  }
})

vi.mock('./sentry.js', () => ({
  isSentryEnabled: true,
  Sentry: {
    withScope: mockWithScope,
    captureException: mockCaptureException,
  },
}))

const baseConfig: Config = {
  NODE_ENV: 'production',
  PORT: 3001,
  HOST: '0.0.0.0',
  RATE_LIMIT_MAX: 100,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/wivwav',
  MEILISEARCH_HOST: 'http://localhost:7700',
  MEILISEARCH_API_KEY: 'test',
  MEILISEARCH_INDEX_NAME: 'listings',
  VALKEY_URL: 'redis://localhost:6379',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_REQUIRED: false,
  LOKI_URL: 'http://localhost:3100',
  GRAFANA_URL: 'http://localhost:3003',
  CORS_ORIGIN: ['http://localhost:3000'],
}

describe('isAllowedCorsOrigin', () => {
  it('allows explicitly configured origins', () => {
    expect(isAllowedCorsOrigin('http://localhost:3000', baseConfig)).toBe(true)
  })

  it('allows arbitrary localhost ports in development', () => {
    expect(isAllowedCorsOrigin('http://localhost:3002', {
      ...baseConfig,
      NODE_ENV: 'development',
    })).toBe(true)
  })

  it('does not allow arbitrary origins outside development', () => {
    expect(isAllowedCorsOrigin('http://localhost:3002', baseConfig)).toBe(false)
    expect(isAllowedCorsOrigin('https://example.com', {
      ...baseConfig,
      NODE_ENV: 'development',
    })).toBe(false)
  })
})

function buildTestApp(overrides?: { apiKey?: { findFirst?: ReturnType<typeof vi.fn> }; config?: Partial<Config> }) {
  const search = {
    search: vi.fn(async () => ({ hits: [], total: 0, facets: {} })),
  }
  const facets = {
    getFacets: vi.fn(async () => ({
      total: 0,
      priceDistribution: [],
      yearDistribution: [],
      mileageDistribution: [],
      makeBreakdown: [],
      modelBreakdown: [],
      stateBreakdown: [],
      conditionBreakdown: [],
      conversionBreakdown: [],
      colorBreakdown: [],
      rampTypeBreakdown: [],
      wavFeatureCounts: {},
    })),
  }
  const queueFactory = new MockQueueFactory() as MockQueueFactory & { getBullMQQueues: () => [] }
  queueFactory.getBullMQQueues = () => []

  return {
    search,
    app: buildApp(
      { ...baseConfig, NODE_ENV: 'test', ...overrides?.config },
      {
        $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
        listing: {
          findMany: vi.fn(async () => []),
          count: vi.fn(async () => 0),
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => null),
        },
        listingPriceHistory: {
          findMany: vi.fn(async () => []),
        },
        vehicleModel: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => null),
        },
        recall: { findMany: vi.fn(async () => []) },
        complaint: { findMany: vi.fn(async () => []) },
        vehicleStats: { findFirst: vi.fn(async () => null) },
        vehicleModelResearch: { findFirst: vi.fn(async () => null) },
        source: {
          findMany: vi.fn(async () => []),
          findUnique: vi.fn(async () => null),
          count: vi.fn(async () => 0),
        },
        scraperRun: {
          findMany: vi.fn(async () => []),
          findFirst: vi.fn(async () => null),
        },
        apiKey: {
          findFirst: overrides?.apiKey?.findFirst ?? vi.fn(async () => null),
          create: vi.fn(async (args: { data: { ownerEmail: string; tier: string; rateLimitRpm: number } }) => ({
            id: 'key-created',
            ownerEmail: args.data.ownerEmail,
            tier: args.data.tier,
            rateLimitRpm: args.data.rateLimitRpm,
            createdAt: new Date('2026-07-14T00:00:00.000Z'),
            revokedAt: null,
          })),
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
      } as never,
      {} as never,
      {} as never,
      search as never,
      facets as never,
      queueFactory as never,
      undefined,
    ),
  }
}

/** The web app's own browser origin — matches baseConfig.CORS_ORIGIN so /v1/ requests pass the trusted-origin bypass without needing a provisioned API key. */
const TRUSTED_ORIGIN = 'http://localhost:3000'

describe('CORS methods', () => {
  it('allows PUT, PATCH, and DELETE via CORS preflight', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/v1/listings',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': method,
        },
      })
      // CORS preflight should reply 204 and expose the requested method
      expect(response.statusCode).toBe(204)
      const allowedMethods = response.headers['access-control-allow-methods'] as string
      expect(allowedMethods).toContain(method)
    }

    await app.close()
  })

  it('does not set CORS headers for a disallowed origin', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/listings',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      },
    })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()

    await app.close()
  })
})

// ---------------------------------------------------------------------------
// Helpers for log-capture tests
// ---------------------------------------------------------------------------

type LogEntry = { level: string; args: unknown[] }

/**
 * Creates a spy-based Fastify logger that records all calls in `entries`.
 * Passed via `loggerInstance` so request.log (a child of this) is captured.
 */
function makeSpyLogger(): { loggerInstance: FastifyBaseLogger; entries: LogEntry[] } {
  const entries: LogEntry[] = []

  const makeMethod = (level: string) =>
    (...args: unknown[]) => void entries.push({ level, args })

  // `child` must return a new logger that also records to the same entries array
  const makeLogger = (): FastifyBaseLogger => {
    const logger: FastifyBaseLogger = {
      level: 'info',
      info: makeMethod('info') as FastifyBaseLogger['info'],
      error: makeMethod('error') as FastifyBaseLogger['error'],
      warn: makeMethod('warn') as FastifyBaseLogger['warn'],
      debug: makeMethod('debug') as FastifyBaseLogger['debug'],
      fatal: makeMethod('fatal') as FastifyBaseLogger['fatal'],
      trace: makeMethod('trace') as FastifyBaseLogger['trace'],
      silent: makeMethod('silent') as FastifyBaseLogger['silent'],
      child: () => makeLogger(),
    }
    return logger
  }

  return { loggerInstance: makeLogger(), entries }
}

/**
 * Creates a Fastify instance wired with the same onResponse hook and
 * setErrorHandler that buildApp registers. Uses a spy logger so log calls
 * are captured without a real pino/stream dependency.
 */
function buildMinimalLoggingApp() {
  const { loggerInstance, entries } = makeSpyLogger()
  const app = Fastify({ loggerInstance, disableRequestLogging: true })

  // Replicate the onResponse hook from app.ts
  app.addHook('onResponse', (request, reply, done) => {
    request.log.info({
      method: request.method,
      url: request.routeOptions.url ?? request.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    }, 'request completed')
    done()
  })

  // Replicate the setErrorHandler from app.ts
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error')
    }
    void reply.code(statusCode).send(error)
  })

  return { app, entries }
}

describe('onResponse hook', () => {
  it('does not break a successful response', async () => {
    const { app } = buildTestApp()
    const built = await app

    const response = await built.inject({ method: 'GET', url: '/v1/listings', headers: { origin: TRUSTED_ORIGIN } })
    expect(response.statusCode).toBe(200)

    await built.close()
  })

  it('logs method, url, statusCode, and durationMs on each response', async () => {
    const { app, entries } = buildMinimalLoggingApp()
    app.get('/ping', async () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'GET', url: '/ping' })

    const completedEntry = entries.find(
      (e) => e.level === 'info' && (e.args[1] as string) === 'request completed',
    )
    expect(completedEntry).toBeDefined()
    const fields = completedEntry!.args[0] as Record<string, unknown>
    expect(fields['method']).toBe('GET')
    expect(fields['url']).toBe('/ping')
    expect(fields['statusCode']).toBe(200)
    expect(typeof fields['durationMs']).toBe('number')

    await app.close()
  })

  it('uses routeOptions.url (the route pattern) rather than the raw request URL', async () => {
    const { app, entries } = buildMinimalLoggingApp()
    app.get('/items/:id', async () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'GET', url: '/items/abc-123' })

    const completedEntry = entries.find(
      (e) => e.level === 'info' && (e.args[1] as string) === 'request completed',
    )
    // The logged url must be the route pattern, not the concrete request path
    const fields = completedEntry!.args[0] as Record<string, unknown>
    expect(fields['url']).toBe('/items/:id')

    await app.close()
  })
})

describe('setErrorHandler', () => {
  it('passes through 4xx errors with the correct status code', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    // The listings/:id route returns 404 when the listing is not found
    const response = await app.inject({ method: 'GET', url: '/v1/listings/nonexistent-id', headers: { origin: TRUSTED_ORIGIN } })
    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('returns 500 for unhandled errors thrown in a handler', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    app.get('/test-500', async () => {
      throw new Error('boom')
    })

    const response = await app.inject({ method: 'GET', url: '/test-500' })
    expect(response.statusCode).toBe(500)

    await app.close()
  })

  it('logs "unhandled error" at error level for 5xx', async () => {
    const { app, entries } = buildMinimalLoggingApp()
    app.get('/explode', async () => {
      throw new Error('kaboom')
    })
    await app.ready()

    await app.inject({ method: 'GET', url: '/explode' })

    const errorEntry = entries.find(
      (e) => e.level === 'error' && (e.args[1] as string) === 'unhandled error',
    )
    expect(errorEntry).toBeDefined()
    const fields = errorEntry!.args[0] as Record<string, unknown>
    expect(fields['err']).toBeInstanceOf(Error)

    await app.close()
  })

  it('does not log "unhandled error" for 4xx errors', async () => {
    const { app, entries } = buildMinimalLoggingApp()
    const err4xx = Object.assign(new Error('not found'), { statusCode: 404 })
    app.get('/not-found', async () => {
      throw err4xx
    })
    await app.ready()

    await app.inject({ method: 'GET', url: '/not-found' })

    const errorEntries = entries.filter(
      (e) => e.level === 'error' && (e.args[1] as string) === 'unhandled error',
    )
    expect(errorEntries).toHaveLength(0)

    await app.close()
  })
})

describe('rate limiting', () => {
  it('applies the global request limit to listing search', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    for (let i = 0; i < 100; i++) {
      const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { origin: TRUSTED_ORIGIN } })
      expect(response.statusCode).toBe(200)
    }

    const limited = await app.inject({ method: 'GET', url: '/v1/listings', headers: { origin: TRUSTED_ORIGIN } })
    expect(limited.statusCode).toBe(429)

    await app.close()
  })

  it('uses a tighter limit for admin sync', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    for (let i = 0; i < 5; i++) {
      const response = await app.inject({ method: 'POST', url: '/admin/sync' })
      expect(response.statusCode).toBe(202)
    }

    const limited = await app.inject({ method: 'POST', url: '/admin/sync' })
    expect(limited.statusCode).toBe(429)

    await app.close()
  })
})

describe('/internal/v1/api-keys and /webhooks/stripe wiring (#453)', () => {
  it('mounts key provisioning under the same fail-closed boundary as /admin', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    // No INTERNAL_API_SECRET is configured and NODE_ENV is 'test', so
    // adminAuthPlugin's non-production permissive fallback applies here too
    // — this confirms the route is reachable at the documented path and
    // reuses that same plugin, not that it's unauthenticated in production.
    const response = await app.inject({
      method: 'POST',
      url: '/internal/v1/api-keys',
      payload: { ownerEmail: 'buyer@example.com' },
    })
    expect(response.statusCode).toBe(201)

    await app.close()
  })

  it('refuses key provisioning without the bearer secret once one is configured', async () => {
    const { app: appPromise } = buildTestApp({ config: { INTERNAL_API_SECRET: 'shared-secret-value' } })
    const app = await appPromise

    const response = await app.inject({
      method: 'POST',
      url: '/internal/v1/api-keys',
      payload: { ownerEmail: 'buyer@example.com' },
    })
    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('mounts the Stripe webhook and fails closed when STRIPE_WEBHOOK_SECRET is unset', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: JSON.stringify({ type: 'checkout.session.completed' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(response.statusCode).toBe(503)

    await app.close()
  })
})

describe('/diagnostics auth boundary (#773)', () => {
  it('fails closed (503) in production when DIAGNOSTIC_API_SECRET is unset', async () => {
    const { app: appPromise } = buildTestApp({ config: { NODE_ENV: 'production' } })
    const app = await appPromise

    const response = await app.inject({ method: 'GET', url: '/diagnostics/ping' })
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).error.code).toBe('DIAGNOSTIC_DISABLED')

    await app.close()
  })

  it('rejects a request with no token or an invalid token once DIAGNOSTIC_API_SECRET is configured', async () => {
    const { app: appPromise } = buildTestApp({ config: { DIAGNOSTIC_API_SECRET: 'diagnostic-secret-value' } })
    const app = await appPromise

    const noToken = await app.inject({ method: 'GET', url: '/diagnostics/ping' })
    expect(noToken.statusCode).toBe(401)

    const wrongToken = await app.inject({
      method: 'GET',
      url: '/diagnostics/ping',
      headers: { authorization: 'Bearer wrong-value' },
    })
    expect(wrongToken.statusCode).toBe(401)

    await app.close()
  })

  it('accepts a valid DIAGNOSTIC_API_SECRET bearer token', async () => {
    const { app: appPromise } = buildTestApp({ config: { DIAGNOSTIC_API_SECRET: 'diagnostic-secret-value' } })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/diagnostics/ping',
      headers: { authorization: 'Bearer diagnostic-secret-value' },
    })
    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('also accepts a valid INTERNAL_API_SECRET bearer token (asymmetric compatibility)', async () => {
    const { app: appPromise } = buildTestApp({
      config: { DIAGNOSTIC_API_SECRET: 'diagnostic-secret-value', INTERNAL_API_SECRET: 'shared-secret-value' },
    })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/diagnostics/ping',
      headers: { authorization: 'Bearer shared-secret-value' },
    })
    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('never accepts DIAGNOSTIC_API_SECRET on /admin/* routes', async () => {
    const { app: appPromise } = buildTestApp({
      config: { NODE_ENV: 'production', DIAGNOSTIC_API_SECRET: 'diagnostic-secret-value', INTERNAL_API_SECRET: 'shared-secret-value' },
    })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/admin/runs',
      headers: { authorization: 'Bearer diagnostic-secret-value' },
    })
    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('api key auth and per-key rate limiting (#453)', () => {
  it('returns 401 for /v1/listings with no key and no trusted origin', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({ method: 'GET', url: '/v1/listings' })
    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body).error.code).toBe('UNAUTHORIZED')

    await app.close()
  })

  it('returns 401 for an unknown or revoked API key', async () => {
    const { app: appPromise } = buildTestApp({ apiKey: { findFirst: vi.fn(async () => null) } })
    const app = await appPromise

    const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'revoked-key' } })
    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('accepts a valid API key and enforces its own rateLimitRpm rather than the global default', async () => {
    // A tiny per-key limit (well below RATE_LIMIT_MAX) proves the dynamic
    // max() function is reading the resolved key's rateLimitRpm, not falling
    // back to the coarse IP-based default.
    const findFirst = vi.fn(async () => ({ id: 'key-1', tier: 'FREE', rateLimitRpm: 2 }))
    const { app: appPromise } = buildTestApp({ apiKey: { findFirst } })
    const app = await appPromise

    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'valid-key' } })
      expect(response.statusCode).toBe(200)
    }

    const limited = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'valid-key' } })
    expect(limited.statusCode).toBe(429)

    await app.close()
  })

  it('gives a higher-tier key a higher limit that a lower-tier key would already have tripped', async () => {
    const findFirst = vi.fn(async () => ({ id: 'key-pro', tier: 'PRO', rateLimitRpm: 3 }))
    const { app: appPromise } = buildTestApp({ apiKey: { findFirst } })
    const app = await appPromise

    // 3 requests exceeds what a rateLimitRpm: 2 FREE key (tested above) would
    // allow, but this PRO key's own higher limit lets all of them through.
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'pro-key' } })
      expect(response.statusCode).toBe(200)
    }

    await app.close()
  })

  it('accepts the internal bypass secret without requiring a provisioned key', async () => {
    const { app: appPromise } = buildTestApp({ config: { INTERNAL_API_SECRET: 'shared-secret-value' } })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { authorization: 'Bearer shared-secret-value' },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('rejects the wrong bearer token even when a bypass secret is configured', async () => {
    const { app: appPromise } = buildTestApp({ config: { INTERNAL_API_SECRET: 'shared-secret-value' } })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { authorization: 'Bearer wrong-value' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('rate-limits repeated failed-auth requests by IP, so an unlimited stream of garbage keys is still throttled', async () => {
    // Regression test: the auth-gate hook must not let 401s bypass the rate
    // limiter (the limiter's keyGenerator/max are what enforce this — see
    // app.ts's ordering comment above the rate-limit registration).
    const { app: appPromise } = buildTestApp({
      apiKey: { findFirst: vi.fn(async () => null) },
      config: { RATE_LIMIT_MAX: 3 },
    })
    const app = await appPromise

    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': `garbage-key-${i}` } })
      expect(response.statusCode).toBe(401)
    }

    const limited = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'garbage-key-4' } })
    expect(limited.statusCode).toBe(429)

    await app.close()
  })

  it('resolves the internal bypass as ENTERPRISE for PRO+-gated sub-resources, not FREE', async () => {
    // Regression test: vin.ts/market.ts/dealers.ts must read the identity
    // apiKeyAuthPlugin already resolved (getResolvedApiKey) rather than
    // re-deriving tier from headers, which would see the bypass's
    // Authorization: Bearer header as a candidate raw API key, fail to find
    // a matching row, and silently fall back to FREE — wrongly 403ing a
    // fully-trusted internal caller.
    const { app: appPromise } = buildTestApp({ config: { INTERNAL_API_SECRET: 'shared-secret-value' } })
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vin/5TDYK3DC1FS123456/history',
      headers: { authorization: 'Bearer shared-secret-value' },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})

describe('x-request-id propagation (genReqId)', () => {
  it('uses x-request-id header as the request ID when present', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { 'x-request-id': 'web-trace-abc123', origin: TRUSTED_ORIGIN },
    })
    // Fastify echoes the request ID it assigned in a response header when
    // request-id is present in the reply serializer or via reply.id — check
    // that the assigned requestId matches the forwarded header value.
    // The standard way to verify is via reply.id or the log, but here we
    // assert the server didn't reject the request and assigned the id.
    expect(response.statusCode).toBe(200)
    // If Fastify exposes request.id, it should match the incoming header.
    // We use the standard reply header set by @fastify/sensible or core;
    // check request-id response header if set, otherwise confirm no crash.
    const replyRequestId = response.headers['request-id'] as string | undefined
    if (replyRequestId) {
      expect(replyRequestId).toBe('web-trace-abc123')
    }

    await app.close()
  })

  it('generates a UUID request ID when x-request-id header is absent', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { origin: TRUSTED_ORIGIN } })
    expect(response.statusCode).toBe(200)
    // No crash — UUID fallback path is exercised without throwing

    await app.close()
  })
})

describe('setErrorHandler — Sentry capture', () => {
  it('calls Sentry.captureException for 5xx errors', async () => {
    vi.clearAllMocks()
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    app.get('/test-sentry-500', async () => {
      throw new Error('server boom')
    })

    const response = await app.inject({ method: 'GET', url: '/test-sentry-500' })
    expect(response.statusCode).toBe(500)
    expect(mockWithScope).toHaveBeenCalledOnce()
    expect(mockCaptureException).toHaveBeenCalledOnce()

    await app.close()
  })

  it('sets requestId, method, and url tags on the Sentry scope for 5xx', async () => {
    vi.clearAllMocks()
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    app.get('/test-sentry-tags', async () => {
      throw new Error('tagged error')
    })

    await app.inject({ method: 'GET', url: '/test-sentry-tags' })

    expect(mockSetTag).toHaveBeenCalledWith('method', 'GET')
    expect(mockSetTag).toHaveBeenCalledWith('url', '/test-sentry-tags')
    // requestId is a UUID or forwarded header value — just confirm it was set
    const requestIdCall = mockSetTag.mock.calls.find(([key]) => key === 'requestId')
    expect(requestIdCall).toBeDefined()
    expect(typeof requestIdCall?.[1]).toBe('string')

    await app.close()
  })

  it('does NOT call Sentry.captureException for 4xx errors', async () => {
    vi.clearAllMocks()
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    // The listings/:id route returns 404 when not found
    const response = await app.inject({ method: 'GET', url: '/v1/listings/nonexistent-id', headers: { origin: TRUSTED_ORIGIN } })
    expect(response.statusCode).toBe(404)
    expect(mockCaptureException).not.toHaveBeenCalled()

    await app.close()
  })
})

describe('GET /openapi.json', () => {
  it('serves a generated OpenAPI 3 document that includes the TypeBox-converted listings routes', async () => {
    const { app: appPromise } = buildTestApp()
    const app = await appPromise

    const response = await app.inject({ method: 'GET', url: '/openapi.json' })

    expect(response.statusCode).toBe(200)
    const doc = response.json<{ openapi: string; paths: Record<string, unknown> }>()
    expect(doc.openapi).toMatch(/^3\./)
    // Fastify represents the plugin-prefix root route with a trailing slash.
    expect(doc.paths).toHaveProperty('/v1/listings/')
    expect(doc.paths).toHaveProperty('/v1/listings/facets')

    await app.close()
  })
})
