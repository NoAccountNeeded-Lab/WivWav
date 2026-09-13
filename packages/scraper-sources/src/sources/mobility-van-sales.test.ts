import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { RobotsCache } from '../util/robots-cache.js'
import {
  MobilityVanSalesAdapter,
  buildDiscoveryIndexUrls,
  buildListing,
  extractBrowseAdIds,
  extractSecondaryBrowseUrls,
  hashPage1Entries,
  normalizeImageUrl,
  normalizeSourceUrl,
  parseBrowsePageHtml,
  parseConversionType,
  parseDetailPageHtml,
  parseListGroupFields,
  parseLocationHeader,
  parseMileage,
  parsePriceCents,
  parseRampType,
  parseSellerType,
} from './mobility-van-sales.js'
import type { FetchPage, FetchResult } from './mobility-van-sales.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const browseV1Html = readFileSync(join(fixtureDir, 'mobility-van-sales-browse-v1.html'), 'utf-8')
const browseEmptyHtml = readFileSync(join(fixtureDir, 'mobility-van-sales-browse-empty.html'), 'utf-8')
const detailV1Html = readFileSync(join(fixtureDir, 'mobility-van-sales-detail-v1.html'), 'utf-8')
const detailDealerHtml = readFileSync(join(fixtureDir, 'mobility-van-sales-detail-dealer.html'), 'utf-8')

const allowAllRobots = { isAllowed: async () => true, clear(): void {} } as unknown as RobotsCache

function fakeFetchPage(routes: Record<string, FetchResult>): FetchPage {
  return async (url: string) => {
    const result = routes[url]
    if (!result) throw new Error(`Unexpected fetch: ${url}`)
    return result
  }
}

describe('buildDiscoveryIndexUrls', () => {
  it('includes main, category, make, and state browse indexes', () => {
    const urls = buildDiscoveryIndexUrls()
    expect(urls).toContain('https://www.mobilityvansales.com/used-handicap-vans/usa-handicap-vansales.html')
    expect(urls).toContain('https://www.mobilityvansales.com/search/ford-wheelchair-vans-for-sale_c865.html')
    expect(urls).toContain('https://www.mobilityvansales.com/search/find-new-used-ohio_wheelchair-vans.html')
    expect(urls.length).toBeGreaterThan(60)
  })
})

describe('parseBrowsePageHtml', () => {
  it('parses listing cards from a browse page fixture', () => {
    const cards = parseBrowsePageHtml(browseV1Html)
    expect(cards).toHaveLength(10)
    expect(cards[0]).toMatchObject({
      adId: '173241',
      sellerTypeLabel: 'Private Listing',
      priceText: '$45,000',
      mileageText: '37,000 miles',
    })
  })

  it('returns an empty array when no result items are present', () => {
    expect(parseBrowsePageHtml(browseEmptyHtml)).toEqual([])
  })
})

describe('extractSecondaryBrowseUrls', () => {
  it('extracts state×make browse links when present in sidebar markup', () => {
    const html = '<a href="/used-handicap-vans/ohio_ford_vansales.html">Ford</a>'
    expect(extractSecondaryBrowseUrls(html)).toContain('/used-handicap-vans/ohio_ford_vansales.html')
  })
})

describe('parseDetailPageHtml', () => {
  it('parses structured list-group fields and seller type from a detail fixture', () => {
    const parsed = parseDetailPageHtml(detailV1Html)
    expect(parsed.sellerType).toBe('private')
    expect(parsed.fields).toMatchObject({
      Year: '2002',
      Make: 'Ford',
      Model: 'E150',
      Miles: '149,000',
      VIN: '1FDRE14L22HA13031',
      'Ad ID': '172079',
      'Handicap Entry': 'Rear Entrance',
    })
    expect(parsed.priceText).toBe('$1,900')
    expect(parsed.imageUrls.length).toBeGreaterThan(0)
    expect(parsed.locationHeader).toContain('Brunswick')
  })

  it('classifies dealer listings when the badge is present', () => {
    expect(parseDetailPageHtml(detailDealerHtml).sellerType).toBe('dealer')
  })

  it('returns empty fields for malformed HTML', () => {
    const parsed = parseDetailPageHtml('<html><body>no listing</body></html>')
    expect(parsed.fields).toEqual({})
    expect(parsed.sellerType).toBeNull()
  })
})

describe('parseSellerType', () => {
  it('detects private and dealer labels case-insensitively', () => {
    expect(parseSellerType('badge-premium-listing">Private listing')).toBe('private')
    expect(parseSellerType('Dealer Listing badge')).toBe('dealer')
    expect(parseSellerType('no seller signal')).toBeNull()
  })
})

describe('parseListGroupFields', () => {
  it('extracts badge/value pairs and ignores cross-link rows', () => {
    const fields = parseListGroupFields(detailV1Html)
    expect(fields.VIN).toBe('1FDRE14L22HA13031')
    expect(fields['More:']).toBeUndefined()
  })
})

describe('buildListing', () => {
  const detailUrl = 'https://www.mobilityvansales.com/buy/USED-2002-FORD-E150-HANDICAP-FULL%20SIZE%20VAN-FOR-SALE-BRUNSWICK-OHIO-172079.htm'

  it('normalizes a complete private listing without dealer contact fields', () => {
    const listing = buildListing(parseDetailPageHtml(detailV1Html), detailUrl)
    expect(listing).not.toBeNull()
    expect(listing!.sellerType).toBe('private')
    expect(listing!.year).toBe(2002)
    expect(listing!.make).toBe('Ford')
    expect(listing!.model).toBe('E150')
    expect(listing!.vin).toBe('1FDRE14L22HA13031')
    expect(listing!.priceCents).toBe(190_000)
    expect(listing!.mileage).toBe(149_000)
    expect(listing!.wav.conversionType).toBe('rear_entry')
    expect(listing!.location.city).toBe('Brunswick')
    expect(listing!.location.state).toBe('OH')
    expect(listing!.dealer).toEqual({ name: null, phone: null, website: null })
    expect(listing!.buyerUrl).toBe(detailUrl)
    expect(listing!.images.length).toBeGreaterThan(0)
  })

  it('classifies dealer listings when the page exposes that signal', () => {
    const listing = buildListing(parseDetailPageHtml(detailDealerHtml), detailUrl)
    expect(listing?.sellerType).toBe('dealer')
  })

  it('returns null when required identity fields are missing', () => {
    const listing = buildListing(parseDetailPageHtml('<html></html>'), detailUrl)
    expect(listing).toBeNull()
  })
})

describe('parsePriceCents / parseMileage / parseLocationHeader', () => {
  it('parses currency and mileage strings', () => {
    expect(parsePriceCents('$45,000')).toBe(4_500_000)
    expect(parseMileage('37,000 miles')).toBe(37_000)
  })

  it('parses city, state, and zip from the location header', () => {
    expect(parseLocationHeader('Brunswick, Ohio 44212')).toEqual({
      city: 'Brunswick',
      state: 'OH',
      zip: '44212',
      lat: null,
      lng: null,
    })
  })
})

describe('parseConversionType / parseRampType / normalizeImageUrl', () => {
  it('maps handicap entry and ramp phrases', () => {
    expect(parseConversionType('Rear Entrance')).toBe('rear_entry')
    expect(parseConversionType('Side Entrance')).toBe('side_entry')
    expect(parseRampType('power fold-out ramp')).toBe('fold_out')
  })

  it('upgrades thumbnail image URLs to full-size paths', () => {
    expect(normalizeImageUrl('https://www.mobilityvansales.com/van_ad_photos/thumb_mobility_van_sales_1.jpg'))
      .toBe('https://www.mobilityvansales.com/van_ad_photos/mobility_van_sales_1.jpg')
  })
})

describe('hashPage1Entries / normalizeSourceUrl', () => {
  it('hashes sorted ad IDs deterministically', () => {
    const hash = hashPage1Entries(['2', '1', '3'])
    expect(hash).toHaveLength(64)
    expect(hashPage1Entries(['3', '2', '1'])).toBe(hash)
  })

  it('normalizes source URLs without query strings', () => {
    expect(normalizeSourceUrl('https://www.mobilityvansales.com/buy/foo.htm?x=1'))
      .toBe('https://www.mobilityvansales.com/buy/foo.htm')
  })
})

describe('MobilityVanSalesAdapter', () => {
  const mainBrowseUrl = 'https://www.mobilityvansales.com/used-handicap-vans/usa-handicap-vansales.html'

  it('checkPage1 hashes browse ad IDs', async () => {
    const adapter = new MobilityVanSalesAdapter(null, {
      fetchPage: fakeFetchPage({
        [mainBrowseUrl]: { url: mainBrowseUrl, status: 200, text: browseV1Html },
      }),
    })
    const result = await adapter.checkPage1()
    expect(result.currentHash).toHaveLength(64)
    expect(extractBrowseAdIds(browseV1Html).length).toBeGreaterThan(0)
  })

  it('checkStructure hashes detail field badges', async () => {
    const firstDetailUrl = parseBrowsePageHtml(browseV1Html)[0]!.detailUrl
    const adapter = new MobilityVanSalesAdapter(null, {
      fetchPage: fakeFetchPage({
        [mainBrowseUrl]: { url: mainBrowseUrl, status: 200, text: browseV1Html },
        [firstDetailUrl]: { url: firstDetailUrl, status: 200, text: detailV1Html },
      }),
    })
    const result = await adapter.checkStructure()
    expect(result.currentHash).toHaveLength(64)
    expect(result.changed).toBe(false)
  })

  it('scrape skips robots-disallowed URLs and normalizes discovered listings', async () => {
    const adapter = new MobilityVanSalesAdapter(null, {
      robotsCache: {
        isAllowed: async (url: string) => !url.includes('/search-used-handicapvans/'),
        clear(): void {},
      } as unknown as RobotsCache,
      fetchPage: async (url: string) => {
        if (url === mainBrowseUrl) return { url, status: 200, text: browseV1Html }
        if (url.includes('/buy/')) return { url, status: 200, text: detailV1Html }
        return { url, status: 404, text: '' }
      },
      detailFetchDelayMs: 0,
      indexFetchDelayMs: 0,
      maxListings: 1,
    })

    const result = await adapter.scrape()
    expect(result.listings).toHaveLength(1)
    expect(result.listings[0]?.sellerType).toBe('private')
    expect(result.fingerprintHash).toHaveLength(64)
  })

  it('scrape returns zero listings for an empty browse index set', async () => {
    const adapter = new MobilityVanSalesAdapter(null, {
      robotsCache: allowAllRobots,
      fetchPage: async (url: string) => {
        if (url === mainBrowseUrl) return { url, status: 200, text: browseEmptyHtml }
        return { url, status: 404, text: '' }
      },
      detailFetchDelayMs: 0,
      indexFetchDelayMs: 0,
    })

    const result = await adapter.scrape()
    expect(result.listings).toEqual([])
  })
})
