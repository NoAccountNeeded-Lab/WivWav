import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createVinEnrichHandler } from './vin-enrich.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function vpicResult(make: string, model: string, year: number): Response {
  return jsonResponse({
    Results: [
      { Variable: 'Make', Value: make },
      { Variable: 'Model', Value: model },
      { Variable: 'Model Year', Value: String(year) },
      { Variable: 'Trim', Value: 'SE' },
      { Variable: 'Body Class', Value: 'Minivan' },
    ],
  })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    claimVinEnrichListings: vi.fn(async () => ({ listings: [] })),
    resolveVinEnrichListing: vi.fn(async () => ({ vehicleModelId: null })),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createVinEnrichHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a clean decode as enriched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => vpicResult('Toyota', 'Sienna', 2023)))
    const resolveVinEnrichListing = vi.fn(async () => ({ vehicleModelId: 'vm1' }))
    const gateway = fakeGateway({
      claimVinEnrichListings: vi.fn(async () => ({
        listings: [{ id: 'l1', vin: '1FTBW2CM5NKA12345', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      resolveVinEnrichListing,
    })

    const handler = createVinEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(resolveVinEnrichListing).toHaveBeenCalledWith({
      listingId: 'l1',
      outcome: 'enriched',
      decoded: { make: 'toyota', model: 'sienna', year: 2023, trim: 'se', bodyType: 'minivan' },
    })
  })

  it('quarantines a listing whose scraped identity mismatches the NHTSA decode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => vpicResult('Honda', 'Odyssey', 2023)))
    const resolveVinEnrichListing = vi.fn(async () => ({ vehicleModelId: null }))
    const gateway = fakeGateway({
      claimVinEnrichListings: vi.fn(async () => ({
        listings: [{ id: 'l1', vin: '1FTBW2CM5NKA12345', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      resolveVinEnrichListing,
    })

    const handler = createVinEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')

    expect(result).toEqual({ processed: 1 })
    expect(resolveVinEnrichListing).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: 'l1', outcome: 'mismatched' }),
    )
  })

  it('marks the listing failed when vPIC returns no usable decode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ Results: [] })))
    const resolveVinEnrichListing = vi.fn(async () => ({ vehicleModelId: null }))
    const gateway = fakeGateway({
      claimVinEnrichListings: vi.fn(async () => ({
        listings: [{ id: 'l1', vin: '1FTBW2CM5NKA12345', make: 'Toyota', model: 'Sienna', year: 2023 }],
      })),
      resolveVinEnrichListing,
    })

    const handler = createVinEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-3')

    expect(result).toEqual({ processed: 0 })
    expect(resolveVinEnrichListing).toHaveBeenCalledWith({ listingId: 'l1', outcome: 'failed' })
  })

  it('returns processed: 0 when no listings are claimed', async () => {
    const gateway = fakeGateway()
    const handler = createVinEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-4')
    expect(result).toEqual({ processed: 0 })
  })
})
