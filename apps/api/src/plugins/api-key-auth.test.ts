import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { describe, expect, it, vi } from 'vitest'
import { apiKeyAuthPlugin, getResolvedApiKey, INTERNAL_BYPASS_RATE_LIMIT_RPM } from './api-key-auth.js'
import type { ApiKeyRepository } from '../repositories/index.js'

function buildTestApp(opts: {
  apiKeys?: Partial<ApiKeyRepository>
  internalApiSecret?: string | undefined
  isTrustedOrigin?: (origin: string | undefined) => boolean
}) {
  const app = Fastify()
  // apiKeyAuthPlugin manually invokes app.rateLimit() (decorated by this
  // plugin), so it must already be registered — matches app.ts's real
  // registration order.
  void app.register(rateLimit, { timeWindow: '1 minute' })
  void app.register(async (v1Scope) => {
    await v1Scope.register(apiKeyAuthPlugin, {
      apiKeys: (opts.apiKeys ?? { findActiveByHash: vi.fn(async () => null) }) as ApiKeyRepository,
      internalApiSecret: opts.internalApiSecret,
      isTrustedOrigin: opts.isTrustedOrigin ?? (() => false),
    })
    v1Scope.get('/listings', async (req) => ({ data: getResolvedApiKey(req) ?? null }))
  }, { prefix: '/v1' })
  app.get('/health', async () => ({ ok: true }))
  return app
}

describe('apiKeyAuthPlugin', () => {
  it('does not gate routes outside /v1', async () => {
    const app = buildTestApp({})
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('rejects requests with no key, no bypass secret, and no trusted origin', async () => {
    const app = buildTestApp({})
    const response = await app.inject({ method: 'GET', url: '/v1/listings' })
    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body).error.code).toBe('UNAUTHORIZED')
    await app.close()
  })

  it('accepts a valid, non-revoked API key and resolves its tier/limit', async () => {
    const findActiveByHash = vi.fn(async () => ({ id: 'key-1', tier: 'PRO' as const, rateLimitRpm: 600 }))
    const app = buildTestApp({ apiKeys: { findActiveByHash } })

    const response = await app.inject({ method: 'GET', url: '/v1/listings', headers: { 'x-api-key': 'raw-key' } })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).data).toEqual({ id: 'key-1', tier: 'PRO', rateLimitRpm: 600 })
    await app.close()
  })

  it('rejects an unknown or revoked key rather than falling back to a trusted origin', async () => {
    const findActiveByHash = vi.fn(async () => null)
    const app = buildTestApp({ apiKeys: { findActiveByHash }, isTrustedOrigin: () => true })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { 'x-api-key': 'revoked-key', origin: 'http://localhost:3000' },
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('accepts the internal bypass secret and resolves an ENTERPRISE-tier, high-limit identity', async () => {
    const app = buildTestApp({ internalApiSecret: 'shared-secret' })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { authorization: 'Bearer shared-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).data).toEqual({ id: 'internal', tier: 'ENTERPRISE', rateLimitRpm: INTERNAL_BYPASS_RATE_LIMIT_RPM })
    await app.close()
  })

  it('rejects an incorrect bearer token even when a bypass secret is configured', async () => {
    const app = buildTestApp({ internalApiSecret: 'shared-secret' })
    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('accepts a trusted-origin request with no key, resolving FREE tier with no explicit rate limit override', async () => {
    const app = buildTestApp({ isTrustedOrigin: (origin) => origin === 'http://localhost:3000' })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { origin: 'http://localhost:3000' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).data).toEqual({ id: null, tier: 'FREE', rateLimitRpm: null })
    await app.close()
  })

  it('rejects a request with an untrusted origin and no key', async () => {
    const app = buildTestApp({ isTrustedOrigin: (origin) => origin === 'http://localhost:3000' })
    const response = await app.inject({
      method: 'GET',
      url: '/v1/listings',
      headers: { origin: 'https://evil.example.com' },
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
