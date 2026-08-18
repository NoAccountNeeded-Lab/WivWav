import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import type { HttpEnrichGatewayClient } from '../http-enrich-gateway-client.js'
import { createDealerEnrichHandler } from './dealer-enrich.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeGateway(overrides: Partial<HttpEnrichGatewayClient> = {}): HttpEnrichGatewayClient {
  return {
    listDealerEnrichPending: vi.fn(async () => ({ dealers: [] })),
    submitDealerEnrich: vi.fn(async () => ({ dealerId: 'd1' })),
    ...overrides,
  } as unknown as HttpEnrichGatewayClient
}

describe('createDealerEnrichHandler', () => {
  const originalKey = process.env['GOOGLE_PLACES_API_KEY']

  beforeEach(() => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalKey === undefined) delete process.env['GOOGLE_PLACES_API_KEY']
    else process.env['GOOGLE_PLACES_API_KEY'] = originalKey
  })

  it('enriches a dealer via Places text-search + details and submits the result', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('findplacefromtext')) {
        return jsonResponse({ status: 'OK', candidates: [{ place_id: 'place-1' }] })
      }
      return jsonResponse({
        status: 'OK',
        result: {
          rating: 4.5,
          user_ratings_total: 120,
          reviews: [{ author_name: 'A', rating: 5, text: 'great', time: 1700000000 }],
        },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const submitDealerEnrich = vi.fn(async () => ({ dealerId: 'd1' }))
    const gateway = fakeGateway({
      listDealerEnrichPending: vi.fn(async () => ({ dealers: [{ dealerName: 'ACME Mobility', zip: '90210' }] })),
      submitDealerEnrich,
    })

    const handler = createDealerEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-1')

    expect(result).toEqual({ processed: 1 })
    expect(submitDealerEnrich).toHaveBeenCalledWith(
      expect.objectContaining({
        dealerName: 'ACME Mobility',
        zip: '90210',
        googlePlaceId: 'place-1',
        rating: 4.5,
        reviewCount: 120,
      }),
    )
  })

  it('skips gracefully with processed: 0 when GOOGLE_PLACES_API_KEY is not set', async () => {
    delete process.env['GOOGLE_PLACES_API_KEY']
    const gateway = fakeGateway()
    const handler = createDealerEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-2')
    expect(result).toEqual({ processed: 0 })
    expect(gateway.listDealerEnrichPending).not.toHaveBeenCalled()
  })

  it('counts a dealer as failed (not processed) when no Place is found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'ZERO_RESULTS', candidates: [] })))
    const gateway = fakeGateway({
      listDealerEnrichPending: vi.fn(async () => ({ dealers: [{ dealerName: 'ACME Mobility', zip: '90210' }] })),
    })

    const handler = createDealerEnrichHandler(gateway, createNoopLogger())
    const result = await handler({}, 'corr-3')
    expect(result).toEqual({ processed: 0 })
  })
})
