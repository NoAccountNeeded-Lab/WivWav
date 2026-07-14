import { randomBytes } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { ApiKeyTier } from '@wivwav/types'
import type { ApiKeyRepository } from '../repositories/index.js'
import { hashApiKey, defaultRateLimitForTier } from '../services/api-key-tier.js'

interface InternalApiKeysPluginOptions {
  apiKeys: ApiKeyRepository
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

/**
 * Key provisioning for the public `/v1/` API (#453). Mounted under
 * `/internal/v1/api-keys`, guarded by the same fail-closed
 * `Authorization: Bearer {INTERNAL_API_SECRET}` boundary as `/admin` (see
 * `plugins/admin-auth.ts` and app.ts) — this is an operator/billing-system
 * surface, never called from a browser.
 */
export const internalApiKeysRoutes: FastifyPluginAsync<InternalApiKeysPluginOptions> = async (app, { apiKeys }) => {
  // POST /internal/v1/api-keys — provision a key. Returns the raw key exactly
  // once; only its SHA-256 hash is persisted.
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

  // DELETE /internal/v1/api-keys/:id — revoke a key. Revoked keys fail
  // authentication (401) on every subsequent /v1/ request.
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const revoked = await apiKeys.revoke(req.params.id)
    if (!revoked) {
      return reply.notFound(`API key "${req.params.id}" not found or already revoked`)
    }
    return reply.send({ data: { id: req.params.id, revoked: true } })
  })
}
