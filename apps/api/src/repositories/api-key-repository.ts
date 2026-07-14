import type { PrismaClient } from '@wivwav/db'
import type { ApiKeyTier } from '@wivwav/types'

export type ActiveApiKeyRow = {
  id: string
  tier: ApiKeyTier
  rateLimitRpm: number
}

export type ApiKeyRow = {
  id: string
  ownerEmail: string
  tier: ApiKeyTier
  rateLimitRpm: number
  createdAt: Date
  revokedAt: Date | null
}

export interface CreateApiKeyInput {
  keyHash: string
  ownerEmail: string
  tier: ApiKeyTier
  rateLimitRpm: number
}

export interface ApiKeyRepository {
  /** Looks up a non-revoked key by its SHA-256 hash. Returns null if missing or revoked. */
  findActiveByHash(keyHash: string): Promise<ActiveApiKeyRow | null>

  /** Provisions a new key row. `keyHash` must already be hashed — the raw key is never persisted. */
  create(input: CreateApiKeyInput): Promise<ApiKeyRow>

  /** Sets `revokedAt` for a key. Returns false if the key does not exist or is already revoked. */
  revoke(id: string): Promise<boolean>

  /**
   * Updates tier and rate limit for every active (non-revoked) key owned by
   * `ownerEmail` — used by the Stripe webhook on a tier-upgrade event. Returns
   * the number of keys updated (0 if no active key matches the email).
   */
  updateTierByOwnerEmail(ownerEmail: string, tier: ApiKeyTier, rateLimitRpm: number): Promise<number>
}

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  findActiveByHash(keyHash: string): Promise<ActiveApiKeyRow | null> {
    return this.db.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
      select: { id: true, tier: true, rateLimitRpm: true },
    })
  }

  create(input: CreateApiKeyInput): Promise<ApiKeyRow> {
    return this.db.apiKey.create({
      data: input,
      select: { id: true, ownerEmail: true, tier: true, rateLimitRpm: true, createdAt: true, revokedAt: true },
    })
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.db.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count > 0
  }

  async updateTierByOwnerEmail(ownerEmail: string, tier: ApiKeyTier, rateLimitRpm: number): Promise<number> {
    const result = await this.db.apiKey.updateMany({
      where: { ownerEmail, revokedAt: null },
      data: { tier, rateLimitRpm },
    })
    return result.count
  }
}
