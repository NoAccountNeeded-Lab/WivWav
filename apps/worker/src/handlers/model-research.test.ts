import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createModelResearchHandler } from './model-research.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listModelResearchPending: vi.fn(async () => ({ vehicleModels: [] })),
    submitModelResearch: vi.fn(async () => ({ created: true })),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createModelResearchHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits EPA-derived claims and returns the processed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          vehicle: [{ city08: 19, hwy08: 26, combMpgData: 22, drive: 'Front-Wheel Drive', fuelType: 'Regular Gasoline', trany: 'Automatic 8-spd' }],
        }),
      ),
    )
    const submitModelResearch = vi.fn(async () => ({ created: true }))
    const gateway = fakeGateway({
      listModelResearchPending: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      submitModelResearch,
    })

    const handler = createModelResearchHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(submitModelResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleModelId: 'vm1',
        researchVersion: 1,
        sourceName: 'EPA FuelEconomy.gov',
        claims: expect.arrayContaining([
          { field: 'fuelEconomyCity', claimText: '19 MPG city', confidence: 'high' },
        ]),
      }),
    )
  })

  it('does not count a model as processed when submitModelResearch loses the race', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ vehicle: [{ city08: 19 }] })))
    const gateway = fakeGateway({
      listModelResearchPending: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      submitModelResearch: vi.fn(async () => ({ created: false })),
    })

    const handler = createModelResearchHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
  })

  it('skips a model when EPA returns no data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ vehicle: [] })))
    const gateway = fakeGateway({
      listModelResearchPending: vi.fn(async () => ({
        vehicleModels: [{ id: 'vm1', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
    })

    const handler = createModelResearchHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-3')
    expect(result).toEqual({ processed: 0 })
  })
})
