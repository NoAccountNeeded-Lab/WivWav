import { describe, it, expect, vi } from 'vitest'
import { EbayMotorsAdapter, buildListing } from './ebay-motors.js'
import type { EbayCredentials } from './factory.js'

const CREDENTIALS: EbayCredentials = { appId: 'app-1', certId: 'cert-1', environment: 'production' }

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function tokenResponse(): Response {
  return jsonResponse(200, { access_token: 'tok-1', expires_in: 7200 })
}

describe('buildListing', () => {
  const baseItem = {
    itemId: 'v1|123|0',
    legacyItemId: '123',
    title: '2019 Dodge Grand Caravan SXT',
    itemWebUrl: 'https://www.ebay.com/itm/123',
    price: { value: '24999.00', currency: 'USD' },
    condition: 'Used',
    image: { imageUrl: 'https://img.ebay.com/1.jpg' },
    itemLocation: { city: 'Columbus', stateOrProvince: 'OH', postalCode: '43215' },
    seller: { username: 'some-seller' },
  }

  it('normalizes a well-formed item summary into a Listing', () => {
    const listing = buildListing(baseItem)
    expect(listing).toMatchObject({
      sourceId: 'ebay-motors',
      sourceUrl: 'https://www.ebay.com/itm/123',
      externalId: '123',
      sourceRecordKey: 'v1|123|0',
      make: 'Dodge',
      model: 'Grand Caravan',
      trim: 'SXT',
      year: 2019,
      priceCents: 2499900,
      condition: 'used',
      sellerType: 'dealer',
      location: { city: 'Columbus', state: 'OH', zip: '43215', lat: null, lng: null },
    })
  })

  it('defaults to dealer when the API reports no seller account type', () => {
    const listing = buildListing({ ...baseItem, seller: { username: 'unclassified-seller' } })
    expect(listing?.sellerType).toBe('dealer')
  })

  it('classifies a disclosed individual seller as private', () => {
    const listing = buildListing({
      ...baseItem,
      seller: { username: 'seller-1', sellerAccountType: 'INDIVIDUAL' },
    })
    expect(listing?.sellerType).toBe('private')
  })

  it('returns null when itemWebUrl is missing', () => {
    const { itemWebUrl, ...withoutUrl } = baseItem
    expect(buildListing(withoutUrl)).toBeNull()
  })

  it('extracts and validates a VIN embedded in the title', () => {
    const listing = buildListing({
      ...baseItem,
      title: '2019 Dodge Grand Caravan SXT VIN 5TDYRKEC8RS205440',
    })
    expect(listing?.vin).toBe('5TDYRKEC8RS205440')
    expect(listing?.qualityIssueCodes ?? []).toEqual([])
  })

  it('flags a VIN with a bad check digit without dropping the listing', () => {
    const listing = buildListing({
      ...baseItem,
      title: '2019 Dodge Grand Caravan SXT VIN 5TDYRKEC8RS205441',
    })
    expect(listing?.vin).toBe('5TDYRKEC8RS205441')
    expect(listing?.qualityIssueCodes).toContain('invalid_check_digit')
  })

  it('returns null for a title that does not parse to a plausible year/make/model', () => {
    expect(buildListing({ ...baseItem, title: 'Great family van for sale' })).toBeNull()
  })

  it('drops non-vehicle images (icons/logos) from the result', () => {
    const listing = buildListing({
      ...baseItem,
      image: { imageUrl: 'https://img.ebay.com/logo-banner.png' },
    })
    expect(listing?.images).toEqual([])
  })
})

describe('EbayMotorsAdapter.scrape', () => {
  it('returns an empty result set when every keyword search comes back empty', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(200, { total: 0, itemSummaries: [] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(result.fingerprintHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('deduplicates items seen across overlapping keyword searches', async () => {
    const item = {
      itemId: 'v1|1|0',
      title: '2020 Toyota Sienna LE',
      itemWebUrl: 'https://www.ebay.com/itm/1',
      itemLocation: {},
    }
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(200, { total: 1, itemSummaries: [item] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toHaveLength(1)
  })

  it('skips malformed/partial item summaries (missing itemWebUrl, or unparseable title) without throwing', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(200, {
        total: 3,
        itemSummaries: [
          { itemId: 'v1|1|0', title: '2021 Honda Odyssey EX-L', itemWebUrl: 'https://www.ebay.com/itm/1' },
          { itemId: 'v1|2|0', title: '2021 Honda Odyssey EX-L' }, // missing itemWebUrl
          { itemId: 'v1|3|0', title: 'not a vehicle title', itemWebUrl: 'https://www.ebay.com/itm/3' },
        ],
      })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings.map((l) => l.sourceRecordKey)).toEqual(['v1|1|0'])
  })

  it('retries a 429 honoring Retry-After, then succeeds', async () => {
    let searchCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      searchCalls += 1
      if (searchCalls === 1) {
        return jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '0' })
      }
      return jsonResponse(200, { total: 0, itemSummaries: [] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(searchCalls).toBeGreaterThan(1)
  })

  it('throws after exhausting retries on sustained 429s', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': '0' })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    await expect(adapter.scrape()).rejects.toThrow(/429/)
  })

  it('throws clearly when credentials are missing', async () => {
    const adapter = new EbayMotorsAdapter(null, { pageDelayMs: 0 })
    await expect(adapter.scrape()).rejects.toThrow(/missing eBay Browse API credentials/)
  })

  it('reuses a cached token across paginated requests instead of re-authenticating', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) {
        tokenCalls += 1
        return tokenResponse()
      }
      return jsonResponse(200, { total: 0, itemSummaries: [] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0 })
    await adapter.scrape()

    expect(tokenCalls).toBe(1)
  })
})

describe('EbayMotorsAdapter.checkStructure', () => {
  it('reports unchanged when no previous hash exists yet', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(200, {
        total: 1,
        itemSummaries: [{ itemId: 'v1|1|0', title: 'x', itemWebUrl: 'https://www.ebay.com/itm/1' }],
      })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(false)
    expect(result.currentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('reports changed when the response envelope shape differs from the previous hash', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      return jsonResponse(200, {
        total: 1,
        itemSummaries: [{ itemId: 'v1|1|0', title: 'x', itemWebUrl: 'https://www.ebay.com/itm/1' }],
      })
    })

    const adapter = new EbayMotorsAdapter('deadbeef', { ebayCredentials: CREDENTIALS, fetchFn })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(true)
  })

  it('hashes the same whether or not an individual item has optional fields (envelope-only signature)', async () => {
    const makeFetch = (item: Record<string, unknown>) =>
      vi.fn(async (url: string | URL | Request) => {
        const u = url.toString()
        if (u.includes('/oauth2/token')) return tokenResponse()
        return jsonResponse(200, { total: 1, itemSummaries: [item] })
      })

    const sparse = await new EbayMotorsAdapter(null, {
      ebayCredentials: CREDENTIALS,
      fetchFn: makeFetch({ itemId: 'v1|1|0', title: 'x', itemWebUrl: 'https://www.ebay.com/itm/1' }),
    }).checkStructure()

    const rich = await new EbayMotorsAdapter(null, {
      ebayCredentials: CREDENTIALS,
      fetchFn: makeFetch({
        itemId: 'v1|2|0',
        title: 'y',
        itemWebUrl: 'https://www.ebay.com/itm/2',
        price: { value: '1.00', currency: 'USD' },
        additionalImages: [{ imageUrl: 'https://img.ebay.com/2.jpg' }],
        seller: { username: 's', sellerAccountType: 'INDIVIDUAL' },
      }),
    }).checkStructure()

    expect(sparse.currentHash).toBe(rich.currentHash)
  })
})
