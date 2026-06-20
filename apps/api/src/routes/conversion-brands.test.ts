import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversionBrandRoutes } from './conversion-brands.js'
import type { ConversionBrandRepository } from '../repositories/conversion-brand-repository.js'

function buildTestApp(repo: Partial<ConversionBrandRepository>) {
  const app = Fastify()
  void app.register(conversionBrandRoutes, {
    conversionBrands: repo as ConversionBrandRepository,
  })
  return app
}

const BRAND_SUMMARY = {
  id: 'clr1',
  name: 'BraunAbility',
  slug: 'braunability',
  website: 'https://www.braunability.com',
  nmedaCertified: true,
  founded: 1972,
  productCount: 4,
}

const BRAND_DETAIL = {
  id: 'clr1',
  name: 'BraunAbility',
  slug: 'braunability',
  website: 'https://www.braunability.com',
  nmedaCertified: true,
  founded: 1972,
  products: [
    {
      id: 'clp1',
      name: 'Chrysler Pacifica Foldout Rear-Entry',
      conversionType: 'rear_entry',
      rampType: 'fold_out',
      floorLoweringInches: null,
      msrpCents: null,
    },
    {
      id: 'clp2',
      name: 'Chrysler Pacifica Foldout Side-Entry',
      conversionType: 'side_entry',
      rampType: 'fold_out',
      floorLoweringInches: 12.0,
      msrpCents: null,
    },
  ],
}

describe('GET /', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns list of brands with product counts', async () => {
    const repo = { findAll: vi.fn().mockResolvedValue([BRAND_SUMMARY]) }
    const app = buildTestApp(repo)

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([BRAND_SUMMARY])
    expect(repo.findAll).toHaveBeenCalledOnce()

    await app.close()
  })

  it('returns 500 with error envelope when repository throws', async () => {
    const repo = { findAll: vi.fn().mockRejectedValue(new Error('db error')) }
    const app = buildTestApp(repo)

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch conversion brands' },
    })

    await app.close()
  })
})

describe('GET /:slug', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns brand detail with product catalog', async () => {
    const repo = { findBySlug: vi.fn().mockResolvedValue(BRAND_DETAIL) }
    const app = buildTestApp(repo)

    const res = await app.inject({ method: 'GET', url: '/braunability' })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.slug).toBe('braunability')
    expect(data.products).toHaveLength(2)
    expect(data.products[0].rampType).toBe('fold_out')
    expect(repo.findBySlug).toHaveBeenCalledWith('braunability')

    await app.close()
  })

  it('returns 404 when brand slug is unknown', async () => {
    const repo = { findBySlug: vi.fn().mockResolvedValue(null) }
    const app = buildTestApp(repo)

    const res = await app.inject({ method: 'GET', url: '/unknown-brand' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Conversion brand not found' },
    })

    await app.close()
  })

  it('returns 500 with error envelope when repository throws', async () => {
    const repo = { findBySlug: vi.fn().mockRejectedValue(new Error('db error')) }
    const app = buildTestApp(repo)

    const res = await app.inject({ method: 'GET', url: '/braunability' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch conversion brand' },
    })

    await app.close()
  })
})
