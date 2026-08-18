import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createNhtsaManufacturerCommunicationsHandler } from './nhtsa-manufacturer-communications.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertManufacturerCommunication: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createNhtsaManufacturerCommunicationsHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('upserts a TSB per tsbId and returns the processed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          results: [{ tsbId: 'TSB-24-01', component: 'BRAKES', summary: 'summary', issuedDate: '20240201' }],
        }),
      ),
    )
    const upsertManufacturerCommunication = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'RAM', model: 'ProMaster', year: 2023 }],
      })),
      upsertManufacturerCommunication,
    })

    const handler = createNhtsaManufacturerCommunicationsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertManufacturerCommunication).toHaveBeenCalledWith({
      vehicleModelId: 'vm1',
      nhtsaId: 'TSB-24-01',
      component: 'BRAKES',
      summary: 'summary',
      issuedDate: new Date(2024, 1, 1),
      sourceUrl: expect.stringContaining('tsbId=TSB-24-01'),
    })
  })

  it('skips TSBs with no tsbId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ tsbId: '', component: 'x', summary: 'y' }] })))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'RAM', model: 'ProMaster', year: 2023 }],
      })),
    })

    const handler = createNhtsaManufacturerCommunicationsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })
})
