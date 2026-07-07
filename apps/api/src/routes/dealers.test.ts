import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dealerRoutes } from './dealers.js'
import type { DealerRepository, ApiKeyRepository } from '../repositories/index.js'

function buildTestApp(dealers: Partial<DealerRepository>, apiKeys: Partial<ApiKeyRepository> = {}) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(dealerRoutes, { dealers: dealers as DealerRepository, apiKeys: apiKeys as ApiKeyRepository })
  return app
}

const PROFILE = { id: 'dp1', name: 'Acme Vans', zip: '60601', rating: 4.6, reviewCount: 42, hours: { mon: '9-6' } }

describe('GET /:id', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the dealer profile', async () => {
    const dealers = { findProfile: vi.fn(async () => PROFILE) }
    const app = buildTestApp(dealers)

    const res = await app.inject({ method: 'GET', url: '/dp1' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(PROFILE)
    await app.close()
  })

  it('returns 404 when the dealer does not exist', async () => {
    const dealers = { findProfile: vi.fn(async () => null) }
    const app = buildTestApp(dealers)

    const res = await app.inject({ method: 'GET', url: '/missing' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /:id/listings', () => {
  afterEach(() => vi.restoreAllMocks())

  const listedAt = new Date('2026-05-01T00:00:00.000Z')
  const LISTING = { id: 'l1', make: 'Toyota', model: 'Sienna', year: 2019, priceCents: 4200000, mileage: 41000, status: 'gone', listedAt, goneAt: new Date('2026-06-01T00:00:00.000Z'), soldAt: null }

  it('returns active listings without an API key (default status)', async () => {
    const dealers = {
      findProfile: vi.fn(async () => PROFILE),
      findListings: vi.fn(async () => [{ ...LISTING, status: 'active', goneAt: null }]),
      countListings: vi.fn(async () => 1),
    }
    const app = buildTestApp(dealers)

    const res = await app.inject({ method: 'GET', url: '/dp1/listings' })

    expect(res.statusCode).toBe(200)
    expect(dealers.findListings).toHaveBeenCalledWith('dp1', 'active', 0, 25)
    expect(res.json().data.pagination).toEqual({ skip: 0, take: 25, total: 1 })
    await app.close()
  })

  it('returns 403 upgrade_required for status=gone with a FREE key', async () => {
    const dealers = { findProfile: vi.fn(async () => PROFILE), findListings: vi.fn(), countListings: vi.fn() }
    const apiKeys = { findActiveByHash: vi.fn(async () => null) }
    const app = buildTestApp(dealers, apiKeys)

    const res = await app.inject({ method: 'GET', url: '/dp1/listings?status=gone' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('upgrade_required')
    expect(dealers.findListings).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns 200 for status=gone with a PRO key', async () => {
    const dealers = {
      findProfile: vi.fn(async () => PROFILE),
      findListings: vi.fn(async () => [LISTING]),
      countListings: vi.fn(async () => 1),
    }
    const apiKeys = { findActiveByHash: vi.fn(async () => ({ tier: 'PRO' as const })) }
    const app = buildTestApp(dealers, apiKeys)

    const res = await app.inject({ method: 'GET', url: '/dp1/listings?status=gone', headers: { 'x-api-key': 'a-pro-key' } })

    expect(res.statusCode).toBe(200)
    expect(dealers.findListings).toHaveBeenCalledWith('dp1', 'gone', 0, 25)
    expect(res.json().data.listings).toMatchObject([{ id: 'l1', status: 'gone' }])
    await app.close()
  })

  it('returns 404 when the dealer does not exist', async () => {
    const dealers = { findProfile: vi.fn(async () => null) }
    const app = buildTestApp(dealers)

    const res = await app.inject({ method: 'GET', url: '/missing/listings' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /:id/reviews', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns reviews without requiring an API key', async () => {
    const REVIEW = { id: 'r1', authorName: 'J. Smith', rating: 5, text: 'Great experience', publishedAt: new Date('2026-06-01T00:00:00.000Z'), source: 'google' }
    const dealers = {
      findProfile: vi.fn(async () => PROFILE),
      findReviews: vi.fn(async () => [REVIEW]),
      countReviews: vi.fn(async () => 1),
    }
    const app = buildTestApp(dealers)

    const res = await app.inject({ method: 'GET', url: '/dp1/reviews' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.reviews).toMatchObject([{ id: 'r1', rating: 5, publishedAt: '2026-06-01T00:00:00.000Z' }])
    expect(res.json().data.pagination).toEqual({ skip: 0, take: 25, total: 1 })
    await app.close()
  })
})
