import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketRoutes } from './market.js'
import type { MarketRepository, ApiKeyRepository } from '../repositories/index.js'

function buildTestApp(market: Partial<MarketRepository>, apiKeys: Partial<ApiKeyRepository> = {}) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(marketRoutes, { market: market as MarketRepository, apiKeys: apiKeys as ApiKeyRepository })
  return app
}

const PRICING_STATS = {
  count: 42,
  p10: 28000_00,
  p25: 32000_00,
  p50: 38000_00,
  p75: 45000_00,
  p90: 55000_00,
  medianMileage: 44800,
  medianDaysListed: 21.6,
  dropTotal: 20,
  dropCount: 6,
}

describe('GET /pricing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requires make and model', async () => {
    const app = buildTestApp({})
    const res = await app.inject({ method: 'GET', url: '/pricing?make=TOYOTA' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns pricing stats for a make/model', async () => {
    const market = { getPricingStats: vi.fn().mockResolvedValue(PRICING_STATS) }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/pricing?make=TOYOTA&model=SIENNA' })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.spec).toEqual({ make: 'TOYOTA', model: 'SIENNA' })
    expect(data.count).toBe(42)
    expect(data.priceCents).toMatchObject({ p10: 2800000, p25: 3200000, p50: 3800000, p75: 4500000, p90: 5500000 })
    expect(data.medianMileage).toBe(44800)
    expect(data.medianDaysListed).toBe(22)
    expect(data.priceDropRate).toBeCloseTo(0.3)
    expect(data.priceDropCount).toBe(6)
    expect(market.getPricingStats).toHaveBeenCalledWith('TOYOTA', 'SIENNA', null, null)

    await app.close()
  })

  it('includes year and conversionType in spec when provided', async () => {
    const market = { getPricingStats: vi.fn().mockResolvedValue(PRICING_STATS) }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/pricing?make=TOYOTA&model=SIENNA&year=2020&conversionType=rear_entry' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.spec).toEqual({ make: 'TOYOTA', model: 'SIENNA', year: 2020, conversionType: 'rear_entry' })
    expect(market.getPricingStats).toHaveBeenCalledWith('TOYOTA', 'SIENNA', 2020, 'rear_entry')

    await app.close()
  })

  it('returns null price stats when no listings match', async () => {
    const market = {
      getPricingStats: vi.fn().mockResolvedValue({
        count: 0,
        p10: null, p25: null, p50: null, p75: null, p90: null,
        medianMileage: null,
        medianDaysListed: null,
        dropTotal: 0,
        dropCount: 0,
      }),
    }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/pricing?make=HONDA&model=ODYSSEY' })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.count).toBe(0)
    expect(data.priceCents).toBeNull()
    expect(data.medianMileage).toBeNull()
    expect(data.medianDaysListed).toBeNull()
    expect(data.priceDropRate).toBeNull()
    expect(data.priceDropCount).toBe(0)

    await app.close()
  })

  it('rejects unknown conversionType', async () => {
    const app = buildTestApp({})
    const res = await app.inject({ method: 'GET', url: '/pricing?make=TOYOTA&model=SIENNA&conversionType=invalid' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 500 with error envelope when repository throws', async () => {
    const market = { getPricingStats: vi.fn().mockRejectedValue(new Error('connection refused')) }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/pricing?make=TOYOTA&model=SIENNA' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pricing data' } })

    await app.close()
  })
})

describe('GET /popular', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns top makes, models, and conversion brands', async () => {
    const popular = {
      makes: [
        { make: 'TOYOTA', count: 234 },
        { make: 'HONDA', count: 87 },
      ],
      models: [
        { make: 'TOYOTA', model: 'SIENNA', count: 189 },
        { make: 'HONDA', model: 'ODYSSEY', count: 62 },
      ],
      conversionBrands: [
        { conversionManufacturer: 'BraunAbility', count: 156 },
        { conversionManufacturer: 'VMI', count: 98 },
      ],
    }
    const market = { getPopular: vi.fn().mockResolvedValue(popular) }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/popular' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(popular)

    await app.close()
  })

  it('returns 500 with error envelope when repository throws', async () => {
    const market = { getPopular: vi.fn().mockRejectedValue(new Error('connection refused')) }
    const app = buildTestApp(market)

    const res = await app.inject({ method: 'GET', url: '/popular' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch popular listings data' } })

    await app.close()
  })
})

describe('GET /trends', () => {
  afterEach(() => vi.restoreAllMocks())

  const TREND_POINTS = [
    { bucketStart: new Date('2026-05-01T00:00:00.000Z'), medianPriceCents: 4500000, activeInventoryCount: 12, avgDaysToGone: 34.5 },
  ]

  it('returns 403 upgrade_required for a FREE-tier caller', async () => {
    const market = { getTrends: vi.fn() }
    const apiKeys = { findActiveByHash: vi.fn().mockResolvedValue(null) }
    const app = buildTestApp(market, apiKeys)

    const res = await app.inject({ method: 'GET', url: '/trends?make=Toyota&model=Sienna&interval=month' })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('upgrade_required')
    expect(market.getTrends).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns trend points for a PRO-tier caller', async () => {
    const market = { getTrends: vi.fn().mockResolvedValue(TREND_POINTS) }
    const apiKeys = { findActiveByHash: vi.fn().mockResolvedValue({ tier: 'PRO' }) }
    const app = buildTestApp(market, apiKeys)

    const res = await app.inject({
      method: 'GET',
      url: '/trends?make=Toyota&model=Sienna&interval=month',
      headers: { 'x-api-key': 'a-pro-key' },
    })

    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.make).toBe('Toyota')
    expect(data.model).toBe('Sienna')
    expect(data.interval).toBe('month')
    expect(data.points).toEqual([
      { bucketStart: '2026-05-01T00:00:00.000Z', medianPriceCents: 4500000, activeInventoryCount: 12, avgDaysToGone: 34.5 },
    ])
    expect(market.getTrends).toHaveBeenCalledWith('Toyota', 'Sienna', 'month', expect.any(Date), expect.any(Date))

    await app.close()
  })

  it('rejects when from is after to', async () => {
    const market = { getTrends: vi.fn() }
    const apiKeys = { findActiveByHash: vi.fn().mockResolvedValue({ tier: 'ENTERPRISE' }) }
    const app = buildTestApp(market, apiKeys)

    const res = await app.inject({
      method: 'GET',
      url: '/trends?make=Toyota&model=Sienna&from=2026-06-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      headers: { 'x-api-key': 'a-key' },
    })

    expect(res.statusCode).toBe(400)

    await app.close()
  })

  it('requires make and model', async () => {
    const app = buildTestApp({ getTrends: vi.fn() })
    const res = await app.inject({ method: 'GET', url: '/trends?make=Toyota' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
