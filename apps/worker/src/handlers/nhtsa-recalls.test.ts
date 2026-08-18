import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createNhtsaRecallsHandler } from './nhtsa-recalls.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listVehicleModels: vi.fn(async () => ({ vehicleModels: [] })),
    upsertRecall: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createNhtsaRecallsHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('upserts a recall per campaign and returns the processed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          results: [
            {
              NHTSACampaignNumber: '23V123',
              Component: 'AIR BAGS',
              Summary: 'summary',
              Remedy: 'remedy',
              ReportReceivedDate: '14/03/2024',
            },
          ],
        }),
      ),
    )
    const upsertRecall = vi.fn(async () => undefined)
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      upsertRecall,
    })

    const handler = createNhtsaRecallsHandler(gateway, createNoopLogger())
    const result = await handler({ vehicleModelId: 'vm1' }, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(upsertRecall).toHaveBeenCalledWith({
      vehicleModelId: 'vm1',
      nhtsaCampaignId: '23V123',
      component: 'AIR BAGS',
      summary: 'summary',
      remedy: 'remedy',
      reportedAt: new Date(2024, 2, 14),
    })
  })

  it('skips recalls with no campaign number and returns processed: 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ NHTSACampaignNumber: '', Component: 'x', Summary: 'y' }] })))
    const gateway = fakeGateway({
      listVehicleModels: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
    })

    const handler = createNhtsaRecallsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')

    expect(result).toEqual({ processed: 0 })
  })

  it('returns processed: 0 with no vehicle models to refresh', async () => {
    const gateway = fakeGateway()
    const handler = createNhtsaRecallsHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-3')
    expect(result).toEqual({ processed: 0 })
  })
})
