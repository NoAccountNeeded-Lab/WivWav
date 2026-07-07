import type { PrismaClient } from '@wivwav/db'
import type { ApiKeyTier } from '@wivwav/types'

export type ActiveApiKeyRow = {
  tier: ApiKeyTier
}

export interface ApiKeyRepository {
  /** Looks up a non-revoked key by its SHA-256 hash. Returns null if missing or revoked. */
  findActiveByHash(keyHash: string): Promise<ActiveApiKeyRow | null>
}

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  findActiveByHash(keyHash: string): Promise<ActiveApiKeyRow | null> {
    return this.db.apiKey.findFirst({
      where: { keyHash, revokedAt: null },
      select: { tier: true },
    })
  }
}
