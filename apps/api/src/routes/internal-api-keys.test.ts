import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { internalApiKeysRoutes } from './internal-api-keys.js'
import type { ApiKeyRepository } from '../repositories/index.js'

function buildTestApp(apiKeys: Partial<ApiKeyRepository>) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(internalApiKeysRoutes, { apiKeys: apiKeys as ApiKeyRepository })
  return app
}

describe('POST /', () => {
  it('creates a key, returns the raw key once, and persists only its hash', async () => {
    const create = vi.fn(async ({ keyHash, ownerEmail, tier, rateLimitRpm }: { keyHash: string; ownerEmail: string; tier: string; rateLimitRpm: number }) => ({
      id: 'key-1',
      ownerEmail,
      tier,
      rateLimitRpm,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      revokedAt: null,
      keyHash,
    }))
    const app = buildTestApp({ create: create as unknown as ApiKeyRepository['create'] })

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ownerEmail: 'buyer@example.com' },
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.body)
    expect(body.data.ownerEmail).toBe('buyer@example.com')
    expect(body.data.tier).toBe('FREE')
    expect(body.data.rateLimitRpm).toBe(60)
    expect(typeof body.data.rawKey).toBe('string')
    expect(body.data.rawKey.startsWith('wav_')).toBe(true)

    // Only the hash reaches the repository — never the raw key.
    const persistedInput = create.mock.calls[0]?.[0] as { keyHash: string }
    expect(persistedInput.keyHash).not.toBe(body.data.rawKey)
    expect(persistedInput.keyHash).toMatch(/^[0-9a-f]{64}$/)

    await app.close()
  })

  it('defaults rateLimitRpm from the requested tier', async () => {
    const create = vi.fn(async (input: { ownerEmail: string; tier: string; rateLimitRpm: number }) => ({
      id: 'key-1',
      ...input,
      createdAt: new Date(),
      revokedAt: null,
    }))
    const app = buildTestApp({ create: create as unknown as ApiKeyRepository['create'] })

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ownerEmail: 'buyer@example.com', tier: 'PRO' },
    })

    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body).data.rateLimitRpm).toBe(600)

    await app.close()
  })

  it('accepts an explicit rateLimitRpm override', async () => {
    const create = vi.fn(async (input: { ownerEmail: string; tier: string; rateLimitRpm: number }) => ({
      id: 'key-1',
      ...input,
      createdAt: new Date(),
      revokedAt: null,
    }))
    const app = buildTestApp({ create: create as unknown as ApiKeyRepository['create'] })

    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ownerEmail: 'buyer@example.com', tier: 'ENTERPRISE', rateLimitRpm: 12000 },
    })

    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body).data.rateLimitRpm).toBe(12000)

    await app.close()
  })

  it('rejects a missing or malformed ownerEmail', async () => {
    const app = buildTestApp({ create: vi.fn() })

    const missing = await app.inject({ method: 'POST', url: '/', payload: {} })
    expect(missing.statusCode).toBe(400)

    const malformed = await app.inject({ method: 'POST', url: '/', payload: { ownerEmail: 'not-an-email' } })
    expect(malformed.statusCode).toBe(400)

    await app.close()
  })

  it('rejects an invalid tier', async () => {
    const app = buildTestApp({ create: vi.fn() })
    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ownerEmail: 'buyer@example.com', tier: 'GOLD' },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('rejects a non-positive rateLimitRpm', async () => {
    const app = buildTestApp({ create: vi.fn() })
    const response = await app.inject({
      method: 'POST',
      url: '/',
      payload: { ownerEmail: 'buyer@example.com', rateLimitRpm: 0 },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })
})

describe('DELETE /:id', () => {
  it('revokes an existing key', async () => {
    const revoke = vi.fn(async () => true)
    const app = buildTestApp({ revoke })

    const response = await app.inject({ method: 'DELETE', url: '/key-1' })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).data).toEqual({ id: 'key-1', revoked: true })
    expect(revoke).toHaveBeenCalledWith('key-1')

    await app.close()
  })

  it('returns 404 for an unknown or already-revoked key', async () => {
    const app = buildTestApp({ revoke: vi.fn(async () => false) })
    const response = await app.inject({ method: 'DELETE', url: '/missing' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
