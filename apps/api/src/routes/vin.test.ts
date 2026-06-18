import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vinRoutes } from './vin.js'

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

function buildTestApp(db: unknown) {
  const app = Fastify()
  void app.register(sensible)
  void app.register(vinRoutes, { db: db as never })
  return app
}

describe('GET /:vin/safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects invalid VINs before calling NHTSA', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const app = buildTestApp({})

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
    const app = buildTestApp({})

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
    const db = {
      vehicleModel: {
        findFirst: vi.fn(async () => ({
          id: 'vm-1',
          make: 'TOYOTA',
          model: 'SIENNA',
          year: 2015,
          trim: 'XLE',
          bodyType: 'Van',
          recalls: [
            { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Dealer remedy', reportedAt },
          ],
          complaints: [
            { id: 'complaint-1', nhtsaId: '1001', component: 'ELECTRICAL SYSTEM', summary: 'Battery drain', mileage: 50000, crashInvolved: false, reportedAt },
            { id: 'complaint-2', nhtsaId: '1002', component: 'ELECTRICAL SYSTEM', summary: 'Door power failure', mileage: null, crashInvolved: false, reportedAt },
            { id: 'complaint-3', nhtsaId: '1003', component: 'STRUCTURE', summary: 'Ramp door complaint', mileage: 75000, crashInvolved: false, reportedAt },
          ],
          safetyRatings: [
            { id: 'rating-1', nhtsaVehicleId: 12345, description: '2015 Toyota Sienna', overallRating: 5, frontCrashRating: 4, sideCrashRating: 5, rolloverRating: 4, rolloverRatingText: '4-star', refreshedAt },
          ],
        })),
      },
      listing: {
        findFirst: vi.fn(async () => ({ id: 'listing-1', conversionManufacturer: 'BraunAbility' })),
      },
    }
    const app = buildTestApp(db)

    const res = await app.inject({ method: 'GET', url: '/5tdyk3dc1fs123456/safety' })

    expect(res.statusCode).toBe(200)
    expect(db.vehicleModel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { make: 'TOYOTA', model: 'SIENNA', year: 2015 },
    }))
    expect(db.listing.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { vin: '5TDYK3DC1FS123456' },
    }))
    expect(res.json().data).toMatchObject({
      vin: '5TDYK3DC1FS123456',
      decoded: { make: 'TOYOTA', model: 'SIENNA', year: 2015 },
      conversionManufacturer: 'BraunAbility',
      sourceListingId: 'listing-1',
      recalls: [{ nhtsaCampaignId: '24V001' }],
      safetyRatings: [{ overallRating: 5 }],
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
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [],
            complaints: [],
            safetyRatings: [
              { id: 'rating-1', nhtsaVehicleId: 12345, description: '2015 Toyota Sienna', overallRating: 5, frontCrashRating: 4, sideCrashRating: 5, rolloverRating: 4, rolloverRatingText: '4-star', refreshedAt },
            ],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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

      // A very old refreshedAt date indicating stale data
      const staleRefreshedAt = new Date('2020-01-01T00:00:00.000Z')
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [],
            complaints: [],
            safetyRatings: [
              { id: 'rating-1', nhtsaVehicleId: 12345, description: '2015 Toyota Sienna', overallRating: 3, frontCrashRating: 3, sideCrashRating: 3, rolloverRating: 3, rolloverRatingText: '3-star', refreshedAt: staleRefreshedAt },
            ],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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

      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [],
            complaints: [],
            safetyRatings: [],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [
              { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Dealer will replace inflator', reportedAt },
            ],
            complaints: [],
            safetyRatings: [],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [
              { id: 'recall-2', nhtsaCampaignId: '24V002', component: 'FUEL SYSTEM', summary: 'Fuel leak risk', remedy: null, reportedAt },
            ],
            complaints: [],
            safetyRatings: [],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [
              { id: 'recall-3', nhtsaCampaignId: '24V003', component: 'BRAKES', summary: 'Brake failure', remedy: '', reportedAt },
            ],
            complaints: [],
            safetyRatings: [],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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
      const db = {
        vehicleModel: {
          findFirst: vi.fn(async () => ({
            id: 'vm-1', make: 'TOYOTA', model: 'SIENNA', year: 2015, trim: 'XLE', bodyType: 'Van',
            recalls: [
              { id: 'recall-1', nhtsaCampaignId: '24V001', component: 'AIR BAGS', summary: 'Air bag issue', remedy: 'Replace inflator at dealer', reportedAt },
              { id: 'recall-2', nhtsaCampaignId: '24V002', component: 'FUEL SYSTEM', summary: 'Fuel leak risk', remedy: null, reportedAt },
            ],
            complaints: [],
            safetyRatings: [],
          })),
        },
        listing: { findFirst: vi.fn(async () => null) },
      }
      const app = buildTestApp(db)

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
