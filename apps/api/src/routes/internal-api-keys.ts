import { randomBytes } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'
import { hashApiKey, defaultRateLimitForTier } from '../services/api-key-tier.js'

interface InternalApiKeysPluginOptions {
  apiKeys: ApiKeyRepository
  includeList?: boolean
}

const VALID_TIERS: ReadonlySet<string> = new Set(['FREE', 'PRO', 'ENTERPRISE'])

function isValidTier(raw: unknown): raw is ApiKeyTier {
  return typeof raw === 'string' && VALID_TIERS.has(raw)
}

function isValidEmail(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
}

/** `wav_` prefix makes leaked keys greppable/identifiable in logs and secret scanners. */
function generateRawApiKey(): string {
  return `wav_${randomBytes(32).toString('base64url')}`
}

function parsePageValue(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > max) return null
  return parsed
}

/**
 * Key management for the public `/v1/` API (#453/#1203). The shared create and
 * revoke handlers are mounted under `/internal/v1/api-keys` for server-to-
 * server provisioning and under `/admin/api-keys` inside the fail-closed
 * admin scope for the Ops BFF. The safe metadata list is enabled only on the
 * admin mount; the browser never receives the internal bearer secret.
 */
export const internalApiKeysRoutes: FastifyPluginAsync<InternalApiKeysPluginOptions> = async (app, { apiKeys, includeList = false }) => {
  if (includeList) {
    app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req, reply) => {
      const limit = parsePageValue(req.query.limit, 50, 100)
      const offset = parsePageValue(req.query.offset, 0, Number.MAX_SAFE_INTEGER)
      if (limit === null || limit < 1) return reply.badRequest('limit must be an integer between 1 and 100')
      if (offset === null) return reply.badRequest('offset must be a non-negative integer')

      const result = await apiKeys.list({ limit, offset })
      return reply.send({
        data: {
          keys: result.rows.map(row => ({
            id: row.id,
            ownerEmail: row.ownerEmail,
            tier: row.tier,
            rateLimitRpm: row.rateLimitRpm,
            createdAt: row.createdAt.toISOString(),
            revokedAt: row.revokedAt?.toISOString() ?? null,
          })),
          pagination: { limit, offset, total: result.total },
        },
      })
    })
  }

  // POST /api-keys — provision a key. Returns the raw key exactly once; only
  // its SHA-256 hash is persisted.
  app.post<{ Body: { ownerEmail?: unknown; tier?: unknown; rateLimitRpm?: unknown } }>('/', async (req, reply) => {
    const { ownerEmail, tier: rawTier, rateLimitRpm: rawRateLimitRpm } = req.body ?? {}

    if (!isValidEmail(ownerEmail)) {
      return reply.badRequest('ownerEmail is required and must be a valid email address')
    }

    if (rawTier !== undefined && !isValidTier(rawTier)) {
      return reply.badRequest(`Invalid tier "${String(rawTier)}". Must be one of: FREE, PRO, ENTERPRISE`)
    }
    const tier: ApiKeyTier = isValidTier(rawTier) ? rawTier : 'FREE'

    let rateLimitRpm = defaultRateLimitForTier(tier)
    if (rawRateLimitRpm !== undefined) {
      if (typeof rawRateLimitRpm !== 'number' || !Number.isInteger(rawRateLimitRpm) || rawRateLimitRpm <= 0) {
        return reply.badRequest('rateLimitRpm must be a positive integer')
      }
      rateLimitRpm = rawRateLimitRpm
    }

    const rawKey = generateRawApiKey()
    const row = await apiKeys.create({ keyHash: hashApiKey(rawKey), ownerEmail, tier, rateLimitRpm })

    return reply.code(201).send({
      data: {
        id: row.id,
        ownerEmail: row.ownerEmail,
        tier: row.tier,
        rateLimitRpm: row.rateLimitRpm,
        createdAt: row.createdAt.toISOString(),
        // Returned exactly once — the API never stores or re-displays the raw key.
        rawKey,
      },
    })
  })

  // DELETE /api-keys/:id — revoke a key. Revoked keys fail authentication
  // (401) on every subsequent /v1/ request.
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const revoked = await apiKeys.revoke(req.params.id)
    if (!revoked) {
      return reply.notFound(`API key "${req.params.id}" not found or already revoked`)
    }
    return reply.send({ data: { id: req.params.id, revoked: true } })
  })
}
