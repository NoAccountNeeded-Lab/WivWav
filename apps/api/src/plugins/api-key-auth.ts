import type { FastifyPluginAsync, FastifyRequest, FastifyInstance, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'
import { extractRawKey, hashApiKey } from '../services/api-key-tier.js'
import type { ApiKeyHeaders } from '../services/api-key-tier.js'

/** `ApiKeyHeaders` plus `Origin`, needed here (not in api-key-tier.ts) for the trusted-origin bypass. */
export interface ApiKeyAuthHeaders extends ApiKeyHeaders {
  origin?: string | undefined
}

/**
 * Aggregate rate limit for internal-secret-bypassed traffic (the web app's
 * server-side calls). This is one shared bucket for the whole web
 * container's SSR fan-out across every concurrent visitor, not a per-visitor
 * limit — it must stay well above the FREE/PRO tier limits, which are
 * per-customer.
 */
export const INTERNAL_BYPASS_RATE_LIMIT_RPM = 6000

/** The resolved caller identity for a `/v1/` request, or null when no valid credential was presented (the request will be rejected with 401). */
export type ResolvedApiKey = {
  /** Null for the internal-secret bypass and the trusted-origin bypass — both share a fixed key rather than a provisioned row. */
  id: string | null
  tier: ApiKeyTier
  /**
   * Requests/minute for this caller, or null to fall back to the
   * IP-keyed global default (`config.RATE_LIMIT_MAX`) — used by the
   * trusted-origin bypass so unauthenticated first-party browser traffic
   * keeps the same behaviour it had before this middleware existed.
   */
  rateLimitRpm: number | null
} | null

const resolvedApiKeys = new WeakMap<FastifyRequest, ResolvedApiKey>()

/**
 * Reads the `ResolvedApiKey` cached by `resolveAndCacheApiKey` for this
 * request, if resolution has already run. `undefined` means resolution
 * hasn't happened yet (non-`/v1/` route, or this hook chain was bypassed
 * entirely, e.g. an isolated route-plugin test) — callers should fall back
 * to their own default in that case. A cached value of `null` is a real,
 * distinct result: resolution ran and found no valid credential.
 */
export function getResolvedApiKey(request: FastifyRequest): ResolvedApiKey | undefined {
  return resolvedApiKeys.get(request)
}

export interface ResolveApiKeyDeps {
  apiKeys: ApiKeyRepository
  /** Shared secret for server-to-server calls (e.g. apps/web's SSR fetches). Same var used for `/admin`. */
  internalApiSecret: string | undefined
  /**
   * True when `origin` is a first-party browser origin (e.g. the web app),
   * used only when no key/secret is presented — lets the site's own
   * client-side chart/facet fetches keep working unauthenticated at the
   * pre-#453 IP-rate-limited behaviour. Must return false for an absent
   * origin: non-browser callers (curl, the acceptance tests, third-party API
   * consumers) never send one and must still be required to authenticate.
   */
  isTrustedOrigin: (origin: string | undefined) => boolean
}

/**
 * Resolves the caller identity for a `/v1/` request, checked in order:
 *
 * 1. `Authorization: Bearer {INTERNAL_API_SECRET}` — the internal
 *    server-to-server bypass apps/web uses so its SSR fetches keep working
 *    without a provisioned key.
 * 2. A valid, non-revoked API key (`X-Api-Key` or `Authorization: Bearer`).
 *    Unknown, malformed, or revoked keys resolve to `null` — they never
 *    silently fall through to a lower trust level (e.g. the trusted-origin
 *    bypass below).
 * 3. A trusted first-party browser `Origin` (see `isTrustedOrigin`) — powers
 *    the site's own unauthenticated client-side fetches (facets/histograms).
 *
 * Anything else resolves to `null` (the caller must reject with 401).
 */
export async function resolveApiKey(headers: ApiKeyAuthHeaders, deps: ResolveApiKeyDeps): Promise<ResolvedApiKey> {
  const { apiKeys, internalApiSecret, isTrustedOrigin } = deps

  const auth = headers.authorization
  if (internalApiSecret && auth === `Bearer ${internalApiSecret}`) {
    return { id: 'internal', tier: 'ENTERPRISE', rateLimitRpm: INTERNAL_BYPASS_RATE_LIMIT_RPM }
  }

  const rawKey = extractRawKey(headers)
  if (rawKey) {
    const row = await apiKeys.findActiveByHash(hashApiKey(rawKey))
    return row ? { id: row.id, tier: row.tier, rateLimitRpm: row.rateLimitRpm } : null
  }

  if (isTrustedOrigin(headers.origin)) {
    return { id: null, tier: 'FREE', rateLimitRpm: null }
  }

  return null
}

/**
 * Resolves (once) and caches the identity for `/v1/` requests; non-`/v1/`
 * requests always cache `null` without doing any lookup. A single
 * resolution serves three consumers: the rate limiter's `keyGenerator`/`max`
 * (via `getResolvedApiKey`), the 401 gate below, and PRO+-gated route
 * handlers (vin.ts, market.ts, dealers.ts), also via `getResolvedApiKey`.
 */
export async function resolveAndCacheApiKey(request: FastifyRequest, deps: ResolveApiKeyDeps): Promise<ResolvedApiKey> {
  const cached = resolvedApiKeys.get(request)
  if (cached !== undefined) return cached

  const resolved = request.url.startsWith('/v1/')
    ? await resolveApiKey(
        { authorization: request.headers.authorization, 'x-api-key': request.headers['x-api-key'], origin: request.headers.origin },
        deps,
      )
    : null
  resolvedApiKeys.set(request, resolved)
  return resolved
}

export type ApiKeyAuthPluginOptions = ResolveApiKeyDeps

/**
 * Fail-closed guard for the public `/v1/` API (#453): 401s any `/v1/`
 * request `resolveAndCacheApiKey` resolves to `null` for (see that
 * function's docstring for the three accepted credentials).
 *
 * Also manually invokes `@fastify/rate-limit`'s check (`app.rateLimit()`,
 * decorated by that plugin — requires it to already be registered on `app`,
 * enforced by registration order in app.ts) *before* the 401 decision.
 * `@fastify/rate-limit` normally applies itself automatically per-route via
 * its own `onRoute` hook, injecting into that route's `onRequest` array —
 * but route-level hooks always run *after* encapsulation-level ones like
 * this plugin's, regardless of registration order. Left to that automatic
 * path, every request this hook rejects with 401 would never reach the rate
 * limiter at all — an unlimited stream of garbage API keys would 401
 * forever without ever being throttled (each still costing a DB lookup).
 * Calling it manually here — before deciding to accept or reject — closes
 * that gap: it sets a `req[rateLimitRan]` sentinel `@fastify/rate-limit`
 * itself defines, so the automatic per-route check (which still runs for
 * requests that pass this gate, since it's also registered with
 * `global: true`) sees it already ran and skips re-checking. No double count.
 *
 * Wrapped with `fastify-plugin` (`fp`) so `app.register(apiKeyAuthPlugin,
 * opts)` attaches its hook to the parent (`app`) instead of creating a new
 * nested encapsulation context — otherwise the hook would only cover routes
 * registered as children of that specific `.register()` call, not the
 * sibling `/v1/*` route registrations in app.ts. Register after
 * `@fastify/rate-limit` (so `app.rateLimit` exists) and after `@fastify/cors`
 * (so CORS preflight short-circuits before either hook runs).
 */
export const apiKeyAuthPlugin: FastifyPluginAsync<ApiKeyAuthPluginOptions> = fp(async (app: FastifyInstance, deps: ApiKeyAuthPluginOptions) => {
  const checkRateLimit = app.rateLimit()

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/v1/')) return undefined

    const resolved = await resolveAndCacheApiKey(req, deps)
    // Throws (statusCode 429) when the caller has exceeded their window;
    // left to propagate to app.ts's setErrorHandler, which reads
    // error.statusCode. Runs before the 401 decision below — see docstring.
    await checkRateLimit.call(app, req, reply)

    if (!resolved) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'An API key is required (X-Api-Key or Authorization: Bearer header), or the key presented is invalid, unknown, or revoked' },
      })
    }

    return undefined
  })
})
