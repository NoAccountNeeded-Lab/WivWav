import { describe, expect, it, vi } from 'vitest'
import { PrismaApiKeyRepository } from './api-key-repository.js'
import type { PrismaClient } from '@wivwav/db'

function buildDb(overrides: Partial<{
  findFirst: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
}>) {
  return {
    apiKey: {
      findFirst: overrides.findFirst ?? vi.fn(),
      create: overrides.create ?? vi.fn(),
      updateMany: overrides.updateMany ?? vi.fn(),
    },
  } as unknown as PrismaClient
}

describe('PrismaApiKeyRepository', () => {
  describe('findActiveByHash', () => {
    it('returns the active key row for a matching hash', async () => {
      const findFirst = vi.fn(async () => ({ id: 'key-1', tier: 'PRO' as const, rateLimitRpm: 600 }))
      const repo = new PrismaApiKeyRepository(buildDb({ findFirst }))

      const row = await repo.findActiveByHash('hash-1')

      expect(row).toEqual({ id: 'key-1', tier: 'PRO', rateLimitRpm: 600 })
      expect(findFirst).toHaveBeenCalledWith({
        where: { keyHash: 'hash-1', revokedAt: null },
        select: { id: true, tier: true, rateLimitRpm: true },
      })
    })

    it('returns null when no active key matches', async () => {
      const repo = new PrismaApiKeyRepository(buildDb({ findFirst: vi.fn(async () => null) }))
      expect(await repo.findActiveByHash('unknown')).toBeNull()
    })
  })

  describe('create', () => {
    it('persists the hashed key and returns the created row', async () => {
      const created = {
        id: 'key-1',
        ownerEmail: 'buyer@example.com',
        tier: 'FREE' as const,
        rateLimitRpm: 60,
        createdAt: new Date('2026-07-14T00:00:00.000Z'),
        revokedAt: null,
      }
      const create = vi.fn(async () => created)
      const repo = new PrismaApiKeyRepository(buildDb({ create }))

      const row = await repo.create({ keyHash: 'hash-1', ownerEmail: 'buyer@example.com', tier: 'FREE', rateLimitRpm: 60 })

      expect(row).toEqual(created)
      expect(create).toHaveBeenCalledWith({
        data: { keyHash: 'hash-1', ownerEmail: 'buyer@example.com', tier: 'FREE', rateLimitRpm: 60 },
        select: { id: true, ownerEmail: true, tier: true, rateLimitRpm: true, createdAt: true, revokedAt: true },
      })
    })
  })

  describe('revoke', () => {
    it('returns true when an active key was revoked', async () => {
      const updateMany = vi.fn(async () => ({ count: 1 }))
      const repo = new PrismaApiKeyRepository(buildDb({ updateMany }))

      expect(await repo.revoke('key-1')).toBe(true)
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'key-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
    })

    it('returns false when the key does not exist or is already revoked', async () => {
      const repo = new PrismaApiKeyRepository(buildDb({ updateMany: vi.fn(async () => ({ count: 0 })) }))
      expect(await repo.revoke('missing')).toBe(false)
    })
  })

  describe('updateTierByOwnerEmail', () => {
    it('updates tier and rate limit for every active key owned by the email', async () => {
      const updateMany = vi.fn(async () => ({ count: 2 }))
      const repo = new PrismaApiKeyRepository(buildDb({ updateMany }))

      const count = await repo.updateTierByOwnerEmail('buyer@example.com', 'PRO', 600)

      expect(count).toBe(2)
      expect(updateMany).toHaveBeenCalledWith({
        where: { ownerEmail: 'buyer@example.com', revokedAt: null },
        data: { tier: 'PRO', rateLimitRpm: 600 },
      })
    })

    it('returns 0 when no active key matches the email', async () => {
      const repo = new PrismaApiKeyRepository(buildDb({ updateMany: vi.fn(async () => ({ count: 0 })) }))
      expect(await repo.updateTierByOwnerEmail('nobody@example.com', 'PRO', 600)).toBe(0)
    })
  })
})
