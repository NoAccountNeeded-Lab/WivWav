import { describe, expect, it, vi } from 'vitest'
import { resolveApiKeyTier, tierAtLeast, hashApiKey, defaultRateLimitForTier, extractRawKey } from './api-key-tier.js'
import type { ApiKeyRepository } from '../repositories/index.js'

describe('resolveApiKeyTier', () => {
  it('resolves FREE when no key header is present', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn() }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, {})
    expect(tier).toBe('FREE')
    expect(apiKeys.findActiveByHash).not.toHaveBeenCalled()
  })

  it('reads the key from X-Api-Key and returns the repository tier', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn(async () => ({ id: 'key-1', tier: 'PRO' as const, rateLimitRpm: 600 })) }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, { 'x-api-key': 'raw-key' })
    expect(tier).toBe('PRO')
    expect(apiKeys.findActiveByHash).toHaveBeenCalledWith(hashApiKey('raw-key'))
  })

  it('reads the key from an array-valued X-Api-Key header', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn(async () => ({ id: 'key-1', tier: 'ENTERPRISE' as const, rateLimitRpm: 6000 })) }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, { 'x-api-key': ['raw-key', 'ignored'] })
    expect(tier).toBe('ENTERPRISE')
    expect(apiKeys.findActiveByHash).toHaveBeenCalledWith(hashApiKey('raw-key'))
  })

  it('falls back to Authorization: Bearer when X-Api-Key is absent', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn(async () => ({ id: 'key-1', tier: 'PRO' as const, rateLimitRpm: 600 })) }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, { authorization: 'Bearer raw-key' })
    expect(tier).toBe('PRO')
    expect(apiKeys.findActiveByHash).toHaveBeenCalledWith(hashApiKey('raw-key'))
  })

  it('resolves FREE for a malformed Authorization header (no Bearer prefix)', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn() }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, { authorization: 'raw-key' })
    expect(tier).toBe('FREE')
    expect(apiKeys.findActiveByHash).not.toHaveBeenCalled()
  })

  it('resolves FREE when the key is unknown or revoked', async () => {
    const apiKeys: Partial<ApiKeyRepository> = { findActiveByHash: vi.fn(async () => null) }
    const tier = await resolveApiKeyTier(apiKeys as ApiKeyRepository, { 'x-api-key': 'unknown-key' })
    expect(tier).toBe('FREE')
  })
})

describe('tierAtLeast', () => {
  it('orders FREE < PRO < ENTERPRISE', () => {
    expect(tierAtLeast('FREE', 'FREE')).toBe(true)
    expect(tierAtLeast('FREE', 'PRO')).toBe(false)
    expect(tierAtLeast('PRO', 'FREE')).toBe(true)
    expect(tierAtLeast('PRO', 'PRO')).toBe(true)
    expect(tierAtLeast('PRO', 'ENTERPRISE')).toBe(false)
    expect(tierAtLeast('ENTERPRISE', 'PRO')).toBe(true)
  })
})

describe('hashApiKey', () => {
  it('produces a stable SHA-256 hex digest', () => {
    expect(hashApiKey('raw-key')).toBe(hashApiKey('raw-key'))
    expect(hashApiKey('raw-key')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashApiKey('raw-key')).not.toBe(hashApiKey('other-key'))
  })
})

describe('defaultRateLimitForTier', () => {
  it('orders FREE < PRO < ENTERPRISE', () => {
    expect(defaultRateLimitForTier('FREE')).toBe(60)
    expect(defaultRateLimitForTier('PRO')).toBe(600)
    expect(defaultRateLimitForTier('ENTERPRISE')).toBe(6000)
    expect(defaultRateLimitForTier('FREE')).toBeLessThan(defaultRateLimitForTier('PRO'))
    expect(defaultRateLimitForTier('PRO')).toBeLessThan(defaultRateLimitForTier('ENTERPRISE'))
  })
})

describe('extractRawKey', () => {
  it('prefers X-Api-Key over Authorization when both are present', () => {
    expect(extractRawKey({ 'x-api-key': 'from-header', authorization: 'Bearer from-bearer' })).toBe('from-header')
  })

  it('returns null when neither header is present', () => {
    expect(extractRawKey({})).toBeNull()
  })
})
