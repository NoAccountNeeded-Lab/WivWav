import { createHash } from 'node:crypto'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'

/** Headers this module reads, typed loosely enough to accept Fastify's/Node's `IncomingHttpHeaders`. */
export interface ApiKeyHeaders {
  'x-api-key'?: string | string[] | undefined
  authorization?: string | undefined
}

function tierRank(tier: ApiKeyTier): number {
  switch (tier) {
    case 'FREE':
      return 0
    case 'PRO':
      return 1
    case 'ENTERPRISE':
      return 2
  }
}

/**
 * Resolves the caller's tier from the `X-Api-Key` or `Authorization: Bearer`
 * header. Missing, malformed, unknown, or revoked keys resolve to `FREE`
 * rather than rejecting the request. Callers behind `plugins/api-key-auth.ts`
 * (all `/v1/` routes, since #453) are guaranteed to already carry a valid key
 * or an explicit auth bypass by the time a route handler runs, so in
 * practice this fallback only matters for routes exercised directly in tests
 * without that middleware; this resolver supplies the tier signal the
 * PRO+-gated routes added in #454 need.
 */
export async function resolveApiKeyTier(apiKeys: ApiKeyRepository, headers: ApiKeyHeaders): Promise<ApiKeyTier> {
  const rawKey = extractRawKey(headers)
  if (!rawKey) return 'FREE'

  const keyHash = hashApiKey(rawKey)
  const row = await apiKeys.findActiveByHash(keyHash)
  return row?.tier ?? 'FREE'
}

/** True when `tier` meets or exceeds `minTier` (FREE < PRO < ENTERPRISE). */
export function tierAtLeast(tier: ApiKeyTier, minTier: ApiKeyTier): boolean {
  return tierRank(tier) >= tierRank(minTier)
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Default `rateLimitRpm` for a tier, applied at key creation and by the
 * Stripe tier-upgrade webhook when the caller doesn't specify an explicit
 * override. Individual keys may still be provisioned with a custom limit
 * (e.g. a negotiated enterprise deal).
 */
export function defaultRateLimitForTier(tier: ApiKeyTier): number {
  switch (tier) {
    case 'FREE':
      return 60
    case 'PRO':
      return 600
    case 'ENTERPRISE':
      return 6000
  }
}

/** Extracts the raw key from `X-Api-Key` or `Authorization: Bearer`, or null if absent/malformed. */
export function extractRawKey(headers: ApiKeyHeaders): string | null {
  const apiKeyHeader = headers['x-api-key']
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) return apiKeyHeader
  if (Array.isArray(apiKeyHeader) && apiKeyHeader[0]) return apiKeyHeader[0]

  const auth = headers.authorization
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim()
    if (token.length > 0) return token
  }

  return null
}
