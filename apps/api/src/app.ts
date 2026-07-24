import { randomUUID } from 'node:crypto'
import { isSentryEnabled, Sentry } from './sentry.js'
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import type { Redis } from 'ioredis'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { createBullBoard } from '@bull-board/api'
import { FastifyAdapter } from '@bull-board/fastify'
import type { CacheService } from './services/cache/index.js'
import type { Meilisearch } from 'meilisearch'
import type { PrismaClient } from '@wivwav/db'
import { createPinoLoggerOptions } from '@wivwav/logger'
import type { BullMQQueueFactory } from '@wivwav/queue'
import { createBullBoardQueues } from '@wivwav/queue/bullmq/board'
import type { Config } from './config.js'
import type { ListingSearchService } from './services/listing-search.js'
import type { ListingFacetsService } from './services/listing-facets.js'
import {
  PrismaListingRepository,
  PrismaVehicleRepository,
  PrismaSourceRepository,
  PrismaScraperRunRepository,
  PrismaMarketRepository,
  PrismaConversionBrandRepository,
  PrismaVehicleIdentityDecisionRepository,
  PrismaDealerRepository,
  PrismaApiKeyRepository,
  PrismaOpsProblemStateRepository,
} from './repositories/index.js'
import { healthRoutes } from './routes/health.js'
import { listingRoutes } from './routes/listings.js'
import { vehicleRoutes } from './routes/vehicles.js'
import { vinRoutes } from './routes/vin.js'
import { marketRoutes } from './routes/market.js'
import { dealerRoutes } from './routes/dealers.js'
import { sourceRoutes } from './routes/sources.js'
import { adminRoutes } from './routes/admin.js'
import { adminVehicleIdentityRoutes } from './routes/admin-vehicle-identity.js'
import { adminAiRoutes } from './routes/admin-ai.js'
import { adminConfigRoutes } from './routes/admin-config.js'
import { adminLogsRoutes } from './routes/admin-logs.js'
import { adminAttentionRoutes } from './routes/admin-attention.js'
import { internalOpsProblemAckRoutes } from './routes/internal-ops-problem-ack.js'
import { internalOpsProblemAggregateRoutes } from './routes/internal-ops-problem-aggregate.js'
import { adminClientEventsRoutes } from './routes/admin-client-events.js'
import { adminAuthPlugin } from './plugins/admin-auth.js'
import { apiKeyAuthPlugin, getResolvedApiKey } from './plugins/api-key-auth.js'
import { metricsRoutes, createMetricsRegistry } from './routes/metrics.js'
import { conversionBrandRoutes } from './routes/conversion-brands.js'
import { internalApiKeysRoutes } from './routes/internal-api-keys.js'
import { internalGrafanaAlertsRoutes } from './routes/internal-grafana-alerts.js'
import { internalSentryIssuesRoutes } from './routes/internal-sentry-issues.js'
import { webhooksRoutes } from './routes/webhooks.js'

export function isAllowedCorsOrigin(origin: string | undefined, config: Config): boolean {
  if (!origin) return true

  const configuredOrigins = Array.isArray(config.CORS_ORIGIN)
    ? config.CORS_ORIGIN
    : [config.CORS_ORIGIN]
  if (configuredOrigins.includes('*') || configuredOrigins.includes(origin)) return true

  if (config.NODE_ENV !== 'development') return false

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Stricter sibling of `isAllowedCorsOrigin` for the `/v1/` auth bypass
 * (plugins/api-key-auth.ts): an absent `Origin` header must NOT be trusted
 * here. `isAllowedCorsOrigin` treats "no Origin header" as allowed because
 * that's how the CORS plugin decides which responses need ACAO headers at
 * all (non-browser callers never send one) — but for authentication, "no
 * Origin" is exactly the case that must fall through to requiring a real key
 * (curl, third-party API clients, and this issue's own acceptance tests).
 */
export function isTrustedBrowserOrigin(origin: string | undefined, config: Config): boolean {
  if (!origin) return false
  return isAllowedCorsOrigin(origin, config)
}

export async function buildApp(
  config: Config,
  db: PrismaClient,
  meili: Meilisearch,
  cache: CacheService,
  search: ListingSearchService,
  facets: ListingFacetsService,
  queueFactory: BullMQQueueFactory,
  redis: Redis | undefined,
) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : createPinoLoggerOptions({ service: 'api', env: config.NODE_ENV }),
    // Custom hooks below handle request/response logging with structured fields.
    disableRequestLogging: true,
    // Honour x-request-id forwarded from the Next.js web layer for end-to-end
    // tracing; fall back to a fresh UUID when the header is absent.
    genReqId: (req: FastifyRequest['raw']) => {
      const forwarded = req.headers['x-request-id']
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? randomUUID()
    },
  }).withTypeProvider<TypeBoxTypeProvider>()

  const { registry, httpRequests, httpDuration } = createMetricsRegistry()

  const listingRepo = new PrismaListingRepository(db)
  const vehicleRepo = new PrismaVehicleRepository(db)
  const sourceRepo = new PrismaSourceRepository(db)
  const scraperRunRepo = new PrismaScraperRunRepository(db)
  const marketRepo = new PrismaMarketRepository(db)
  const conversionBrandRepo = new PrismaConversionBrandRepository(db)
  const vehicleIdentityDecisionRepo = new PrismaVehicleIdentityDecisionRepository(db)
  const dealerRepo = new PrismaDealerRepository(db)
  const apiKeyRepo = new PrismaApiKeyRepository(db)
  const problemStateRepo = new PrismaOpsProblemStateRepository(db)

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isAllowedCorsOrigin(origin, config))
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  })
  await app.register(sensible)

  const apiKeyAuthDeps = {
    apiKeys: apiKeyRepo,
    internalApiSecret: config.INTERNAL_API_SECRET,
    isTrustedOrigin: (origin: string | undefined) => isTrustedBrowserOrigin(origin, config),
  }

  // Per-key, tier-based limit for authenticated /v1/ callers — this *is* the
  // "replace the global limit on /v1" behaviour from #453, expressed as a
  // dynamic max/keyGenerator on the same single limiter rather than a second
  // stacked one (a second registration would double-enforce: FREE's 60/min
  // would still work under either, but a PRO/ENTERPRISE key's higher limit
  // would stay capped by whatever coarse default a second limiter used).
  // Non-/v1 routes and the trusted-origin/no-key /v1 path keep the original
  // IP-keyed config.RATE_LIMIT_MAX behaviour this plugin has always had.
  // keyGenerator/max only ever read getResolvedApiKey (never resolve it
  // themselves) — apiKeyAuthPlugin below resolves+caches identity, then
  // manually invokes this same check (see its docstring for why: registering
  // this before apiKeyAuthPlugin is necessary so `app.rateLimit` exists when
  // that plugin's setup runs, but does NOT by itself make this check run
  // before apiKeyAuthPlugin's 401 decision for a given request).
  await app.register(rateLimit, {
    timeWindow: '1 minute',
    // The shared cache Redis client is `lazyConnect`/`enableOfflineQueue:
    // false` (services/cache is designed to fail soft on a disconnected
    // store). `skipOnError` gives the rate limiter the same fail-soft
    // behaviour instead of turning a Redis hiccup into a 500 on every request.
    skipOnError: true,
    ...(redis ? { redis } : {}),
    keyGenerator: (req) => {
      const resolved = getResolvedApiKey(req)
      return resolved?.id ? `key:${resolved.id}` : req.ip
    },
    max: (req) => {
      const resolved = getResolvedApiKey(req)
      return resolved?.rateLimitRpm ?? config.RATE_LIMIT_MAX
    },
  })

  // Fail-closed guard for /v1/ (#453): requires a valid API key, the internal
  // server-to-server bypass secret, or a trusted first-party browser Origin.
  // Also manually invokes the rate-limit check above before its 401
  // decision, so failed-auth attempts are still throttled — see the
  // extended comment in plugins/api-key-auth.ts for why that's necessary
  // (registration order alone does not make it happen automatically) and
  // why this must be registered after @fastify/rate-limit and after cors.
  await app.register(apiKeyAuthPlugin, apiKeyAuthDeps)

  // Schema-first route contracts (TypeBox) are converted route group by route
  // group — see docs/api-routes.md. The generated OpenAPI 3 document reflects
  // whichever routes currently carry TypeBox schemas; unconverted routes still
  // appear (Fastify introspects every registered route) but without detailed
  // request/response shapes until they are converted in follow-up issues.
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'WivWav API', version: '1.0.0' },
    },
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger())

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info({
      method: request.method,
      url: request.routeOptions.url ?? request.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    }, 'request completed')

    const route = request.routeOptions.url ?? 'unknown'
    const method = request.method
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`
    httpRequests.labels(method, route, statusClass).inc()
    httpDuration.labels(method, route).observe(Math.round(reply.elapsedTime))

    done()
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error')
      // Report 5xx errors to Sentry with request context.
      // Use the parameterised route path (routeOptions.url) rather than the
      // raw request.url which may contain user-supplied query strings.
      if (isSentryEnabled) {
        Sentry.withScope((scope) => {
          scope.setTag('requestId', String(request.id))
          scope.setTag('method', request.method)
          scope.setTag('url', request.routeOptions.url ?? 'unknown')
          Sentry.captureException(error)
        })
      }
    }
    void reply.code(statusCode).send(error)
  })

  await app.register(healthRoutes, { prefix: '/health', db, sources: sourceRepo, scraperRuns: scraperRunRepo, meili, cache, config })
  await app.register(listingRoutes, { prefix: '/v1/listings', listings: listingRepo, search, facets, queueFactory })
  await app.register(vehicleRoutes, { prefix: '/v1/vehicles', vehicles: vehicleRepo })
  await app.register(vinRoutes, { prefix: '/v1/vin', vehicles: vehicleRepo, listings: listingRepo, apiKeys: apiKeyRepo })
  await app.register(marketRoutes, { prefix: '/v1/market', market: marketRepo, apiKeys: apiKeyRepo })
  await app.register(dealerRoutes, { prefix: '/v1/dealers', dealers: dealerRepo, apiKeys: apiKeyRepo })
  await app.register(conversionBrandRoutes, { prefix: '/v1/conversion-brands', conversionBrands: conversionBrandRepo })
  await app.register(sourceRoutes, { prefix: '/v1/sources' })

  // Every route nested under /admin — including Bull Board — is guarded by a
  // single fail-closed auth hook (see plugins/admin-auth.ts). Fastify plugin
  // encapsulation means the hook applies to all children registered inside
  // this callback without each route needing its own check.
  await app.register(
    async (adminScope) => {
      // Called directly (not via .register) so the onRequest hook attaches to
      // adminScope itself rather than a further-nested encapsulation context —
      // otherwise it would only guard routes registered inside this plugin's
      // own scope, not the sibling route registrations below.
      await adminAuthPlugin(adminScope, {
        internalApiSecret: config.INTERNAL_API_SECRET,
        nodeEnv: config.NODE_ENV,
      })

      await adminScope.register(adminRoutes, { db, listings: listingRepo, sources: sourceRepo, scraperRuns: scraperRunRepo, queueFactory })
      await adminScope.register(adminVehicleIdentityRoutes, { prefix: '/vehicle-identity', vehicleIdentityDecisions: vehicleIdentityDecisionRepo })
      await adminScope.register(adminAiRoutes, {
        prefix: '/ai',
        sources: sourceRepo,
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
        queueFactory,
      })
      await adminScope.register(adminConfigRoutes, {
        prefix: '/config',
        db,
        cache,
        encryptionSecret: config.CONFIG_ENCRYPTION_SECRET,
        internalApiSecret: config.INTERNAL_API_SECRET,
      })
      await adminScope.register(adminLogsRoutes, {
        prefix: '/logs',
        lokiUrl: config.LOKI_URL,
      })
      await adminScope.register(adminAttentionRoutes, { prefix: '/attention-snapshot' })

      const boardAdapter = new FastifyAdapter()
      boardAdapter.setBasePath('/admin/board')
      createBullBoard({ queues: createBullBoardQueues(queueFactory), serverAdapter: boardAdapter })
      await adminScope.register(boardAdapter.registerPlugin(), { prefix: '/board' })
    },
    { prefix: '/admin' },
  )

  // Key provisioning (#453) plus the Grafana/Sentry operator-dashboard proxies
  // (#890) — same fail-closed Authorization: Bearer {INTERNAL_API_SECRET}
  // boundary as /admin, reusing adminAuthPlugin directly for the same
  // encapsulation reason documented above. Deliberately a sibling scope to
  // /admin, not nested inside it: these are operator/server-to-server
  // surfaces (billing provisioning, Grafana/Sentry reads for the ops
  // dashboard), never called from a browser.
  await app.register(
    async (internalScope) => {
      await adminAuthPlugin(internalScope, {
        internalApiSecret: config.INTERNAL_API_SECRET,
        nodeEnv: config.NODE_ENV,
      })

      await internalScope.register(internalApiKeysRoutes, { prefix: '/api-keys', apiKeys: apiKeyRepo })
      await internalScope.register(internalGrafanaAlertsRoutes, {
        prefix: '/grafana/alerts',
        grafanaUrl: config.GRAFANA_URL,
        grafanaApiToken: config.GRAFANA_API_TOKEN,
      })
      await internalScope.register(internalSentryIssuesRoutes, {
        prefix: '/sentry/issues',
        sentryAuthToken: config.SENTRY_ISSUES_AUTH_TOKEN,
        sentryOrg: config.SENTRY_ISSUES_ORG,
        sentryProject: config.SENTRY_ISSUES_PROJECT,
      })
    },
    { prefix: '/internal/v1' },
  )

  // New privileged operator APIs mount under /internal/ops/*, not /admin/*.
  // This still uses the existing fail-closed bearer guard until the broader
  // OPS_API_SECRET migration lands.
  await app.register(
    async (internalOpsScope) => {
      await adminAuthPlugin(internalOpsScope, {
        internalApiSecret: config.INTERNAL_API_SECRET,
        nodeEnv: config.NODE_ENV,
      })

      await internalOpsScope.register(internalOpsProblemAckRoutes, {
        prefix: '/problem-ack',
        problemStates: problemStateRepo,
      })
      await internalOpsScope.register(internalOpsProblemAggregateRoutes, {
        prefix: '/problem-aggregate',
        problemStates: problemStateRepo,
        grafanaUrl: config.GRAFANA_URL,
        grafanaApiToken: config.GRAFANA_API_TOKEN,
        sentryAuthToken: config.SENTRY_ISSUES_AUTH_TOKEN,
        sentryOrg: config.SENTRY_ISSUES_ORG,
        sentryProject: config.SENTRY_ISSUES_PROJECT,
      })
    },
    { prefix: '/internal/ops' },
  )

  // Stripe calls this directly and authenticates via the signed payload
  // (Stripe-Signature header), not an API key or the INTERNAL_API_SECRET
  // bearer boundary — see routes/webhooks.ts.
  await app.register(webhooksRoutes, {
    prefix: '/webhooks',
    apiKeys: apiKeyRepo,
    stripeWebhookSecret: config.STRIPE_WEBHOOK_SECRET,
  })

  // Intentionally unauthenticated and outside /admin — this endpoint accepts only
  // pre-validated structured browser error events and is rate-limited per-route.
  // See docs/api-routes.md for the full list of public exceptions to the admin
  // fail-closed boundary (this route, /health, /metrics).
  await app.register(adminClientEventsRoutes, { prefix: '/telemetry/client-events' })
  await app.register(metricsRoutes, {
    prefix: '/metrics',
    db,
    cache,
    meili,
    queueFactory,
    lokiUrl: config.LOKI_URL,
    registry,
  })

  return app
}
