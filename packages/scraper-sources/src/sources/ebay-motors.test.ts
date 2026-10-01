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

function aspect(name: string, value: string) {
  return { name, value }
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
    itemLocation: { city: 'Columbus', stateOrProvince: 'Ohio', postalCode: '432**' },
    localizedAspects: [
      aspect('Year', '2019'),
      aspect('Make', 'Dodge'),
      aspect('Mileage', '47121'),
      aspect('Exterior Color', 'White'),
      aspect('Fuel Type', 'Gasoline'),
      aspect('Transmission', 'Automatic'),
      aspect('For Sale By', 'Dealer'),
    ],
  }

  it('normalizes a well-formed getItem response into a Listing', () => {
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
      mileage: 47121,
      color: 'White',
      fuelType: 'Gasoline',
      transmission: 'Automatic',
      condition: 'used',
      sellerType: 'dealer',
      // postalCode is masked by eBay ("432**") — never stored as a literal ZIP.
      location: { city: 'Columbus', state: 'Ohio', zip: null, lat: null, lng: null },
    })
  })

  it('defaults to dealer when "For Sale By" is absent', () => {
    const { localizedAspects, ...rest } = baseItem
    const listing = buildListing({
      ...rest,
      localizedAspects: localizedAspects.filter((a) => a.name !== 'For Sale By'),
    })
    expect(listing?.sellerType).toBe('dealer')
  })

  it('classifies a disclosed private seller as private', () => {
    const listing = buildListing({
      ...baseItem,
      localizedAspects: [...baseItem.localizedAspects.filter((a) => a.name !== 'For Sale By'), aspect('For Sale By', 'Private Seller')],
    })
    expect(listing?.sellerType).toBe('private')
  })

  it('extracts and validates a VIN from localizedAspects', () => {
    const listing = buildListing({
      ...baseItem,
      localizedAspects: [...baseItem.localizedAspects, aspect('VIN (Vehicle Identification Number)', '5TDYRKEC8RS205440')],
    })
    expect(listing?.vin).toBe('5TDYRKEC8RS205440')
    expect(listing?.qualityIssueCodes ?? []).toEqual([])
  })

  it('flags a VIN with a bad check digit without dropping the listing', () => {
    const listing = buildListing({
      ...baseItem,
      localizedAspects: [...baseItem.localizedAspects, aspect('VIN (Vehicle Identification Number)', '5TDYRKEC8RS205441')],
    })
    expect(listing?.vin).toBe('5TDYRKEC8RS205441')
    expect(listing?.qualityIssueCodes).toContain('invalid_check_digit')
  })

  it('maps "Features" text to WAV feature flags', () => {
    const listing = buildListing({
      ...baseItem,
      localizedAspects: [...baseItem.localizedAspects, aspect('Features', 'Wheelchair Lift, Power Ramp, Hand Controls')],
    })
    expect(listing?.wav.wavFeatures).toEqual(
      expect.arrayContaining(['has_lift', 'power_ramp', 'hand_controls']),
    )
  })

  it('returns null for a title that does not parse to a plausible year/make/model', () => {
    expect(buildListing({ ...baseItem, title: 'Great family van for sale' })).toBeNull()
  })

  it('returns null when itemWebUrl is missing', () => {
    const withoutUrl: Record<string, unknown> = { ...baseItem }
    delete withoutUrl['itemWebUrl']
    expect(buildListing(withoutUrl as typeof baseItem)).toBeNull()
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

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(result.fingerprintHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('deduplicates items seen across overlapping keyword searches and fetches each unique item once', async () => {
    const summary = { itemId: 'v1|1|0' }
    const detail = {
      itemId: 'v1|1|0',
      title: '2020 Toyota Sienna LE',
      itemWebUrl: 'https://www.ebay.com/itm/1',
      localizedAspects: [aspect('Year', '2020')],
    }
    let getItemCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      if (u.includes('/item/')) {
        getItemCalls += 1
        return jsonResponse(200, detail)
      }
      return jsonResponse(200, { total: 1, itemSummaries: [summary] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toHaveLength(1)
    expect(getItemCalls).toBe(1)
  })

  it('skips an item whose getItem call fails, without failing the run', async () => {
    const goodDetail = {
      itemId: 'v1|1|0',
      title: '2021 Honda Odyssey EX-L',
      itemWebUrl: 'https://www.ebay.com/itm/1',
    }
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      if (u.includes('/item/v1%7C1%7C0')) return jsonResponse(200, goodDetail)
      if (u.includes('/item/v1%7C2%7C0')) return jsonResponse(500, { error: 'boom' })
      return jsonResponse(200, { total: 2, itemSummaries: [{ itemId: 'v1|1|0' }, { itemId: 'v1|2|0' }] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings.map((l) => l.sourceRecordKey)).toEqual(['v1|1|0'])
  })

  it('skips a malformed/partial getItem response (missing itemWebUrl, or unparseable title)', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) return tokenResponse()
      if (u.includes('/item/v1%7C1%7C0')) {
        return jsonResponse(200, { itemId: 'v1|1|0', title: '2021 Honda Odyssey EX-L', itemWebUrl: 'https://www.ebay.com/itm/1' })
      }
      if (u.includes('/item/v1%7C2%7C0')) {
        return jsonResponse(200, { itemId: 'v1|2|0', title: '2021 Honda Odyssey EX-L' }) // missing itemWebUrl
      }
      if (u.includes('/item/v1%7C3%7C0')) {
        return jsonResponse(200, { itemId: 'v1|3|0', title: 'not a vehicle title', itemWebUrl: 'https://www.ebay.com/itm/3' })
      }
      return jsonResponse(200, {
        total: 3,
        itemSummaries: [{ itemId: 'v1|1|0' }, { itemId: 'v1|2|0' }, { itemId: 'v1|3|0' }],
      })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
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

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(searchCalls).toBeGreaterThan(1)
  })

  it('throws clearly when credentials are missing', async () => {
    const adapter = new EbayMotorsAdapter(null, { pageDelayMs: 0, detailDelayMs: 0 })
    await expect(adapter.scrape()).rejects.toThrow(/missing eBay Browse API credentials/)
  })

  it('reuses a cached token across paginated and detail requests instead of re-authenticating', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString()
      if (u.includes('/oauth2/token')) {
        tokenCalls += 1
        return tokenResponse()
      }
      if (u.includes('/item/')) {
        return jsonResponse(200, { itemId: 'v1|1|0', title: '2020 Toyota Sienna LE', itemWebUrl: 'https://www.ebay.com/itm/1' })
      }
      return jsonResponse(200, { total: 1, itemSummaries: [{ itemId: 'v1|1|0' }] })
    })

    const adapter = new EbayMotorsAdapter(null, { ebayCredentials: CREDENTIALS, fetchFn, pageDelayMs: 0, detailDelayMs: 0 })
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
        itemSummaries: [{ itemId: 'v1|1|0' }],
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
      return jsonResponse(200, { total: 1, itemSummaries: [{ itemId: 'v1|1|0' }] })
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
      fetchFn: makeFetch({ itemId: 'v1|1|0' }),
    }).checkStructure()

    const rich = await new EbayMotorsAdapter(null, {
      ebayCredentials: CREDENTIALS,
      fetchFn: makeFetch({
        itemId: 'v1|2|0',
        price: { value: '1.00', currency: 'USD' },
        additionalImages: [{ imageUrl: 'https://img.ebay.com/2.jpg' }],
      }),
    }).checkStructure()

    expect(sparse.currentHash).toBe(rich.currentHash)
  })
})
