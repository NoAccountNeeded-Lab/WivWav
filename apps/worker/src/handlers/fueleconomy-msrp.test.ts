import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createFuelEconomyMsrpHandler } from './fueleconomy-msrp.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertFuelEconomyMsrp: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createFuelEconomyMsrpHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('picks the lowest MSRP across variants and upserts it', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('/menu/model')) return jsonResponse({ menuItem: [{ value: 'Sienna 2WD' }] })
      if (href.includes('/menu/options')) return jsonResponse({ vehicle: [{ id: 1 }, { id: 2 }] })
      if (href.includes('/vehicle/1')) return jsonResponse({ msrpLow: '$35,000' })
      if (href.includes('/vehicle/2')) return jsonResponse({ msrpLow: '$32,000' })
      throw new Error(`unexpected url ${href}`)
    })
    vi.stubGlobal('fetch', fetchImpl)

    const upsertFuelEconomyMsrp = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      upsertFuelEconomyMsrp,
    })

    const handler = createFuelEconomyMsrpHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertFuelEconomyMsrp).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleModelId: 'vm1', originalMsrpCents: 3200000 }),
    )
  })

  it('returns processed: 0 when no model names match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ menuItem: [] })))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
    })

    const handler = createFuelEconomyMsrpHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })
})
