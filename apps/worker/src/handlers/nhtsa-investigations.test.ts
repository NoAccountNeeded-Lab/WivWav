import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createNhtsaInvestigationsHandler } from './nhtsa-investigations.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertInvestigation: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createNhtsaInvestigationsHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('upserts an investigation per investigationId and returns the processed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          results: [
            {
              investigationId: 'PE24001',
              component: 'ENGINE',
              summary: 'summary',
              openedDate: '20240101',
              closedDate: null,
              outcome: null,
            },
          ],
        }),
      ),
    )
    const upsertInvestigation = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Ford', model: 'Transit', year: 2023 }],
      })),
      upsertInvestigation,
    })

    const handler = createNhtsaInvestigationsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertInvestigation).toHaveBeenCalledWith({
      vehicleModelId: 'vm1',
      nhtsaId: 'PE24001',
      component: 'ENGINE',
      summary: 'summary',
      openedDate: new Date(2024, 0, 1),
      closedDate: null,
      outcome: null,
      sourceUrl: expect.stringContaining('investigationId=PE24001'),
    })
  })

  it('returns processed: 0 when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Ford', model: 'Transit', year: 2023 }],
      })),
    })

    const handler = createNhtsaInvestigationsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })
})
