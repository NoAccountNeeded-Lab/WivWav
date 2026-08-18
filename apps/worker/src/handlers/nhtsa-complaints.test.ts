import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createNhtsaComplaintsHandler } from './nhtsa-complaints.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertComplaint: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createNhtsaComplaintsHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('upserts a complaint per ODI number and returns the processed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          results: [
            { odiNumber: 12345, components: 'STEERING', summary: 'summary', mileage: 500, crash: true, dateOfIncident: 20240115 },
          ],
        }),
      ),
    )
    const upsertComplaint = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Honda', model: 'Odyssey', year: 2022 }],
      })),
      upsertComplaint,
    })

    const handler = createNhtsaComplaintsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertComplaint).toHaveBeenCalledWith({
      vehicleModelId: 'vm1',
      nhtsaId: '12345',
      component: 'STEERING',
      summary: 'summary',
      mileage: 500,
      crashInvolved: true,
      reportedAt: new Date(2024, 0, 15),
    })
  })

  it('skips complaints with no odiNumber', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ odiNumber: 0, components: 'x', summary: 'y' }] })))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Honda', model: 'Odyssey', year: 2022 }],
      })),
    })

    const handler = createNhtsaComplaintsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })
})
