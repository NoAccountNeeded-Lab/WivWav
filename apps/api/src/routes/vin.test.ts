import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vinRoutes } from './vin.js'
import type { VehicleRepository, ListingRepository, ApiKeyRepository, SafetyRecallRow, SafetyComplaintRow, SafetyRatingRow } from '../repositories/index.js'

function vpicResponse(make: string | null, model: string | null, year: string | null) {
  return {
    Results: [
      { Variable: 'Make', Value: make },
      { Variable: 'Model', Value: model },
      { Variable: 'Model Year', Value: year },
      { Variable: 'Trim', Value: 'XLE' },
      { Variable: 'Body Class', Value: 'Van' },
    ],
  }
}

function buildTestApp(
  vehicles: Partial<VehicleRepository>,
  listings: Partial<ListingRepository>,
  apiKeys: Partial<ApiKeyRepository> = {},
) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(vinRoutes, {
    vehicles: vehicles as VehicleRepository,
    listings: listings as ListingRepository,
    apiKeys: apiKeys as ApiKeyRepository,
  })
  return app
}

const VEHICLE_MODEL_ROW = { id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015 }

function makeVehicleModelWithSafety(overrides: {
  recalls?: SafetyRecallRow[]
  complaints?: SafetyComplaintRow[]
  safetyRatings?: SafetyRatingRow[]
} = {}) {
  return {
    id: 'vm-1',
    make: 'TOYOTA',
    model: 'SIENNA',
    year: 2015,
    trim: 'XLE',
    bodyType: 'Van',
    recalls: overrides.recalls ?? [],
    complaints: overrides.complaints ?? [],
    safetyRatings: overrides.safetyRatings ?? [],
    investigations: [],
    manufacturerCommunications: [],
  }
}

describe('GET /:vin/listings', () => {
  const VIN = '5TDYK3DC1FS123456'

  it('rejects invalid VINs', async () => {
    const app = buildTestApp({}, {})
    const res = await app.inject({ method: 'GET', url: '/not-a-vin/listings' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns active listings for the VIN without requiring an API key', async () => {
    const listedAt = new Date('2026-05-01T00:00:00.000Z')
    const listings = {
      findListingsByVin: vi.fn(async () => [
        { id: 'l1', sourceUrl: 'https://a.example/1', dealerName: 'Acme Vans', priceCents: 4500000, mileage: 32000, status: 'active', listedAt, goneAt: null, soldAt: null },
      ]),
    }
    const app = buildTestApp({}, listings)

    const res = await app.inject({ method: 'GET', url: `/${VIN}/listings` })

    expect(res.statusCode).toBe(200)
    expect(listings.findListingsByVin).toHaveBeenCalledWith(VIN, true)
    expect(res.json().data).toMatchObject({
      vin: VIN,
      listings: [{ id: 'l1', priceCents: 4500000, status: 'active', listedAt: '2026-05-01T00:00:00.000Z', goneAt: null, soldAt: null }],
    })
    await app.close()
  })
})

describe('GET /:vin/history', () => {
  const VIN = '5TDYK3DC1FS123456'

  it('returns 403 upgrade_required for a FREE-tier caller', async () => {
    const listings = { findHistoryByVin: vi.fn() }
    const apiKeys = { findActiveByHash: vi.fn(async () => null) }
    const app = buildTestApp({}, listings, apiKeys)

    const res = await app.inject({ method: 'GET', url: `/${VIN}/history` })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('upgrade_required')
    expect(listings.findHistoryByVin).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns merged price and mileage history for a PRO-tier caller', async () => {
    const recordedAt = new Date('2026-05-01T00:00:00.000Z')
    const listings = {
      findHistoryByVin: vi.fn(async () => [
        { listingId: 'l1', type: 'price' as const, value: 4500000, recordedAt },
        { listingId: 'l1', type: 'mileage' as const, value: 32000, recordedAt },
      ]),
    }
    const apiKeys = { findActiveByHash: vi.fn(async () => ({ id: 'key-1', tier: 'PRO' as const, rateLimitRpm: 600 })) }
    const app = buildTestApp({}, listings, apiKeys)

    const res = await app.inject({ method: 'GET', url: `/${VIN}/history`, headers: { 'x-api-key': 'a-pro-key' } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      vin: VIN,
      history: [
        { listingId: 'l1', type: 'price', value: 4500000, recordedAt: '2026-05-01T00:00:00.000Z' },
        { listingId: 'l1', type: 'mileage', value: 32000, recordedAt: '2026-05-01T00:00:00.000Z' },
      ],
    })
    await app.close()
  })
})

describe('GET /:vin/safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects invalid VINs before calling NHTSA', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const app = buildTestApp({}, {})

    const res = await app.inject({ method: 'GET', url: '/not-a-vin/safety' })

    expect(res.statusCode).toBe(400)
    expect(fetch).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns an empty report when NHTSA cannot decode the VIN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => vpicResponse(null, null, null),
    })))
    const app = buildTestApp({}, {})

    const res = await app.inject({ method: 'GET', url: '/5TDYK3DC1FS123456/safety' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      vin: '5TDYK3DC1FS123456',
      decoded: null,
      recalls: [],
      complaintGroups: [],
      safetyRatings: [],
    })

    await app.close()
  })

  it('returns decoded vehicle safety data and groups complaints by component', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
    })))

    const reportedAt = new Date('2024-01-02T00:00:00.000Z')
    const refreshedAt = new Date('2024-06-01T00:00:00.000Z')

    const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
    const listings = {
      findByVin: vi.fn(async () => ({ id: 'listing-1', conversionManufacturer: 'BraunAbility' })),
      findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
        recalls: [
          { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Dealer remedy', reportedAt },
        ],
        complaints: [
          { id: 'complaint-1', nhtsaId: '1001', component: 'ELECTRICAL SYSTEM', summary: 'Battery drain', mileage: 50000, crashInvolved: false, reportedAt },
          { id: 'complaint-2', nhtsaId: '1002', component: 'ELECTRICAL SYSTEM', summary: 'Door power failure', mileage: null, crashInvolved: false, reportedAt },
          { id: 'complaint-3', nhtsaId: '1003', component: 'STRUCTURE', summary: 'Ramp door complaint', mileage: 75000, crashInvolved: false, reportedAt },
        ],
        safetyRatings: [
          { id: 'rating-1', nhtsaVehicleId: '12345', description: '2015 Toyota Sienna', overallRating: '5', frontCrashRating: '4', sideCrashRating: '5', rolloverRating: '4', rolloverRatingText: '4-star', refreshedAt },
        ],
      })),
    }
    const app = buildTestApp(vehicles, listings)

    const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

    expect(res.statusCode).toBe(200)
    expect(vehicles.findModel).toHaveBeenCalledWith('TOYOTA', 'SIENNA', 2015)
    expect(listings.findByVin).toHaveBeenCalledWith('5TDYK3DC1FS123456')
    expect(listings.findVehicleModelWithSafetyData).toHaveBeenCalledWith('vm-1')
    expect(res.json().data).toMatchObject({
      vin: '5TDYK3DC1FS123456',
      decoded: { make: 'TOYOTA', model: 'SIENNA', year: 2015 },
      conversionManufacturer: 'BraunAbility',
      sourceListingId: 'listing-1',
      recalls: [{ nhtsaCampaignId: '24V001' }],
      safetyRatings: [{ overallRating: '5' }],
      complaintGroups: [
        { component: 'ELECTRICAL SYSTEM', count: 2 },
        { component: 'STRUCTURE', count: 1 },
      ],
    })

    await app.close()
  })

  describe('safety rating freshness', () => {
    it('exposes refreshedAt from persisted safety rating data', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const refreshedAt = new Date('2024-06-01T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          safetyRatings: [
            { id: 'rating-1', nhtsaVehicleId: '12345', description: '2015 Toyota Sienna', overallRating: '5', frontCrashRating: '4', sideCrashRating: '5', rolloverRating: '4', rolloverRatingText: '4-star', refreshedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const safetyRatings = res.json().data.safetyRatings as Array<{ refreshedAt: string }>
      expect(safetyRatings).toHaveLength(1)
      expect(safetyRatings[0]?.refreshedAt).toBe('2024-06-01T00:00:00.000Z')

      await app.close()
    })

    it('exposes stale freshness date when safety ratings have not been recently refreshed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const staleRefreshedAt = new Date('2020-01-01T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          safetyRatings: [
            { id: 'rating-1', nhtsaVehicleId: '12345', description: '2015 Toyota Sienna', overallRating: '3', frontCrashRating: '3', sideCrashRating: '3', rolloverRating: '3', rolloverRatingText: '3-star', refreshedAt: staleRefreshedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const safetyRatings = res.json().data.safetyRatings as Array<{ refreshedAt: string }>
      expect(safetyRatings[0]?.refreshedAt).toBe('2020-01-01T00:00:00.000Z')

      await app.close()
    })

    it('returns empty safetyRatings array when no ratings exist, without implying data is current', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety()),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.safetyRatings).toEqual([])

      await app.close()
    })
  })

  describe('recall status normalization', () => {
    it('assigns status "remedied" when remedy is non-empty', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const reportedAt = new Date('2024-01-02T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          recalls: [
            { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Dealer will replace inflator', reportedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const recalls = res.json().data.recalls as Array<{ status: string; nhtsaCampaignId: string }>
      expect(recalls[0]).toMatchObject({ nhtsaCampaignId: '24V001', status: 'remedied' })

      await app.close()
    })

    it('assigns status "open" when remedy is null', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const reportedAt = new Date('2024-01-02T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          recalls: [
            { id: 'recall-2', nhtsaCampaignId: '24V002', component: 'FUEL SYSTEM', summary: 'Fuel leak risk', remedy: null, reportedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const recalls = res.json().data.recalls as Array<{ status: string }>
      expect(recalls[0]?.status).toBe('open')

      await app.close()
    })

    it('assigns status "open" when remedy is an empty string', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const reportedAt = new Date('2024-01-02T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          recalls: [
            { id: 'recall-3', nhtsaCampaignId: '24V003', component: 'BRAKES', summary: 'Brake failure', remedy: '', reportedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const recalls = res.json().data.recalls as Array<{ status: string }>
      expect(recalls[0]?.status).toBe('open')

      await app.close()
    })

    it('exposes mixed recall statuses correctly', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => vpicResponse('TOYOTA', 'SIENNA', '2015'),
      })))

      const reportedAt = new Date('2024-01-02T00:00:00.000Z')
      const vehicles = { findModel: vi.fn(async () => VEHICLE_MODEL_ROW) }
      const listings = {
        findByVin: vi.fn(async () => null),
        findVehicleModelWithSafetyData: vi.fn(async () => makeVehicleModelWithSafety({
          recalls: [
            { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Replace inflator at dealer', reportedAt },
            { id: 'recall-2', nhtsaCampaignId: '24V002', component: 'FUEL SYSTEM', summary: 'Fuel leak risk', remedy: null, reportedAt },
          ],
        })),
      }
      const app = buildTestApp(vehicles, listings)

      const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

      expect(res.statusCode).toBe(200)
      const recalls = res.json().data.recalls as Array<{ nhtsaCampaignId: string; status: string }>
      const remedied = recalls.find((r) => r.nhtsaCampaignId === '24V001')
      const open = recalls.find((r) => r.nhtsaCampaignId === '24V002')
      expect(remedied?.status).toBe('remedied')
      expect(open?.status).toBe('open')

      await app.close()
    })
  })
})
