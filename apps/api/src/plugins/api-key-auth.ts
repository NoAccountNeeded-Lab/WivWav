import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'
import { extractRawKey, hashApiKey } from '../services/api-key-tier.js'

/**
 * Aggregate rate limit for internal-secret-bypassed traffic (the web app's
 * server-side calls). This is one shared bucket for the whole web
 * container's SSR fan-out across every concurrent visitor, not a per-visitor
 * limit — it must stay well above the FREE/PRO tier limits, which are
 * per-customer.
 */
export const INTERNAL_BYPASS_RATE_LIMIT_RPM = 6000

/** The resolved caller identity attached to each authenticated `/v1/` request. */
export interface ResolvedApiKey {
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
}

const resolvedApiKeys = new WeakMap<FastifyRequest, ResolvedApiKey>()

/** Reads the `ResolvedApiKey` attached by `apiKeyAuthPlugin`'s onRequest hook, if any. */
export function getResolvedApiKey(request: FastifyRequest): ResolvedApiKey | undefined {
  return resolvedApiKeys.get(request)
}

export interface ApiKeyAuthPluginOptions {
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
 * Fail-closed guard for the public `/v1/` API (#453). Every `/v1/` request
 * must present one of, in order:
 *
 * 1. `Authorization: Bearer {INTERNAL_API_SECRET}` — the internal
 *    server-to-server bypass apps/web uses so its SSR fetches keep working
 *    without a provisioned key.
 * 2. A valid, non-revoked API key (`X-Api-Key` or `Authorization: Bearer`).
 *    Unknown, malformed, or revoked keys are rejected — they never silently
 *    fall through to a lower trust level.
 * 3. A trusted first-party browser `Origin` (see `isTrustedOrigin`) — powers
 *    the site's own unauthenticated client-side fetches (facets/histograms).
 *
 * Anything else gets `401 UNAUTHORIZED`. The resolved identity is stashed in
 * a module-level `WeakMap` (read via `getResolvedApiKey`) rather than a
 * Fastify request decorator so the per-key rate-limit config in `app.ts` can
 * read it without a `declare module 'fastify'` augmentation.
 *
 * IMPORTANT: call this function directly — `await apiKeyAuthPlugin(app, opts)`
 * — rather than `app.register(apiKeyAuthPlugin, opts)`, and register it
 * after `@fastify/cors` (so CORS preflight short-circuits before this hook
 * runs) and before `@fastify/rate-limit` (whose `keyGenerator`/`max` depend
 * on the resolved identity this hook attaches). See app.ts and
 * plugins/admin-auth.ts for the same direct-call convention and why it
 * matters for encapsulation.
 */
export const apiKeyAuthPlugin: FastifyPluginAsync<ApiKeyAuthPluginOptions> = async (
  app,
  { apiKeys, internalApiSecret, isTrustedOrigin },
) => {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return undefined

    const auth = req.headers.authorization
    if (internalApiSecret && auth === `Bearer ${internalApiSecret}`) {
      resolvedApiKeys.set(req, { id: 'internal', tier: 'ENTERPRISE', rateLimitRpm: INTERNAL_BYPASS_RATE_LIMIT_RPM })
      return undefined
    }

    const rawKey = extractRawKey(req.headers)
    if (rawKey) {
      const row = await apiKeys.findActiveByHash(hashApiKey(rawKey))
      if (!row) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'API key is invalid, unknown, or revoked' },
        })
      }
      resolvedApiKeys.set(req, { id: row.id, tier: row.tier, rateLimitRpm: row.rateLimitRpm })
      return undefined
    }

    if (isTrustedOrigin(req.headers.origin)) {
      resolvedApiKeys.set(req, { id: null, tier: 'FREE', rateLimitRpm: null })
      return undefined
    }

    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'An API key is required (X-Api-Key or Authorization: Bearer header)' },
    })
  })
}
