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
 * rather than rejecting the request — `/v1/` routes have no authentication
 * requirement yet (that lands with #453's key-provisioning and rate-limiting
 * work); this resolver only supplies the tier signal the gated routes added
 * in #454 need.
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

function extractRawKey(headers: ApiKeyHeaders): string | null {
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
