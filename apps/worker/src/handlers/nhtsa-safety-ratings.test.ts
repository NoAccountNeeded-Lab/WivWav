import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createNhtsaSafetyRatingsHandler } from './nhtsa-safety-ratings.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertSafetyRating: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createNhtsaSafetyRatingsHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches variants then details and upserts a rating per variant', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('/modelyear/')) {
        return jsonResponse({ Results: [{ VehicleId: 42, VehicleDescription: '2023 Toyota Sienna' }] })
      }
      return jsonResponse({
        Results: [
          {
            VehicleId: 42,
            OverallRating: '5',
            OverallFrontCrashRating: '4',
            OverallSideCrashRating: '5',
            RolloverRating: '4',
            RolloverRating2: 'Rollover resistance 4 stars',
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const upsertSafetyRating = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      upsertSafetyRating,
    })

    const handler = createNhtsaSafetyRatingsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertSafetyRating).toHaveBeenCalledWith({
      vehicleModelId: 'vm1',
      nhtsaVehicleId: 42,
      description: '2023 Toyota Sienna',
      overallRating: 5,
      frontCrashRating: 4,
      sideCrashRating: 5,
      rolloverRating: 4,
      rolloverRatingText: 'Rollover resistance 4 stars',
    })
  })

  it('returns processed: 0 when no variants are found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ Results: [] })))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
    })

    const handler = createNhtsaSafetyRatingsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })
})
