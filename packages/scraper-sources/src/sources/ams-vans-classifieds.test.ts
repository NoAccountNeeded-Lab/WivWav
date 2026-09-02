import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import type { RobotsCache } from '../util/robots-cache.js'
import {
  AmsVansClassifiedsAdapter,
  buildListing,
  extractClassifiedVinsFromSitemap,
  extractNextData,
  hashPage1Entries,
  normalizeImageUrl,
  normalizeSourceUrl,
  parseConversionManufacturer,
  parseConversionType,
  parseDetailPageHtml,
  parseRampType,
} from './ams-vans-classifieds.js'
import type { ClassifiedRecord, FetchPage, FetchResult } from './ams-vans-classifieds.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const detailV1Html = readFileSync(join(fixtureDir, 'ams-vans-classifieds-detail-v1.html'), 'utf-8')
const detailV2RenamedFieldHtml = readFileSync(join(fixtureDir, 'ams-vans-classifieds-detail-v2-renamed-field.html'), 'utf-8')
const sitemapV1Xml = readFileSync(join(fixtureDir, 'ams-vans-sitemap-v1.xml'), 'utf-8')

const allowAllRobots = { isAllowed: async () => true, clear(): void {} } as unknown as RobotsCache

function fakeFetchPage(routes: Record<string, FetchResult>): FetchPage {
  return async (url: string) => {
    const result = routes[url]
    if (!result) throw new Error(`Unexpected fetch: ${url}`)
    return result
  }
}

// ─── extractClassifiedVinsFromSitemap ────────────────────────────────────────

describe('extractClassifiedVinsFromSitemap', () => {
  it('extracts VINs from classifieds URLs and ignores unrelated sitemap entries', () => {
    const vins = extractClassifiedVinsFromSitemap(sitemapV1Xml)
    expect(vins).toEqual(['2C4RDGBG8CR297107', '2C4GP54L75R314298'])
  })

  it('returns an empty array when the sitemap has no classifieds entries', () => {
    const xml = '<urlset><url><loc>https://www.amsvans.com/wheelchair-vans/25100010</loc></url></urlset>'
    expect(extractClassifiedVinsFromSitemap(xml)).toEqual([])
  })
})

// ─── extractNextData / parseDetailPageHtml ───────────────────────────────────

describe('extractNextData', () => {
  it('parses the embedded __NEXT_DATA__ JSON payload', () => {
    const data = extractNextData(detailV1Html) as { page: string } | null
    expect(data).not.toBeNull()
    expect(data!.page).toBe('/wheelchair-vans/cl/[vin]')
  })

  it('returns null when no __NEXT_DATA__ script is present', () => {
    expect(extractNextData('<html><body>no data here</body></html>')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{not json</script>'
    expect(extractNextData(html)).toBeNull()
  })
})

describe('parseDetailPageHtml', () => {
  it('parses a Classified page into its record', () => {
    const { pageType, record } = parseDetailPageHtml(detailV1Html)
    expect(pageType).toBe('Classified')
    expect(record).not.toBeNull()
    expect(record!.vin).toBe('2C4RDGBG8CR297107')
    expect(record!.make).toBe('Dodge')
    expect(record!.model).toBe('Grand Caravan')
    expect(record!.year).toBe(2012)
    expect(record!.price).toBe(24999)
    expect(record!.conv_make).toBe('FMI')
    expect(record!.conv_location).toBe('Rear')
    expect(record!.images).toHaveLength(3)
    expect(record!.approved).toBe(1)
    expect(record!.deleted).toBe(0)
  })

  it('never exposes owner_email on the parsed record', () => {
    const { record } = parseDetailPageHtml(detailV1Html)
    expect(record).not.toHaveProperty('owner_email')
    expect(JSON.stringify(record)).not.toContain('@')
  })

  it('returns a null record for a non-Classified page (marketing/landing page shape)', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"page":{"type":"Article","data":null}}}}</script>'
    const { pageType, record } = parseDetailPageHtml(html)
    expect(pageType).toBe('Article')
    expect(record).toBeNull()
  })

  it('returns a null record when required identity fields are missing', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"page":{"type":"Classified","data":{"cl":{"vin":"","year":2020,"make":"Ford","model":"Transit"}}}}}}</script>'
    expect(parseDetailPageHtml(html).record).toBeNull()
  })
})

// ─── normalizeImageUrl ────────────────────────────────────────────────────────

describe('normalizeImageUrl', () => {
  it('adds https: to a protocol-relative URL', () => {
    expect(normalizeImageUrl('//d2fvmu12dwd1j3.cloudfront.net/imgs/cl-uploads/a.jpg'))
      .toBe('https://d2fvmu12dwd1j3.cloudfront.net/imgs/cl-uploads/a.jpg')
  })

  it('leaves an absolute URL unchanged', () => {
    expect(normalizeImageUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })
})

// ─── parseConversionType / parseRampType / parseConversionManufacturer ──────

describe('parseConversionType', () => {
  it('maps conv_location to rear_entry / side_entry', () => {
    expect(parseConversionType('Rear')).toBe('rear_entry')
    expect(parseConversionType('Side')).toBe('side_entry')
  })

  it('returns unknown for null or unrecognized values', () => {
    expect(parseConversionType(null)).toBe('unknown')
    expect(parseConversionType('')).toBe('unknown')
  })
})

describe('parseRampType', () => {
  it('detects fold-out, fold-in, and in-floor variants', () => {
    expect(parseRampType('Power Fold-Out Ramp')).toBe('fold_out')
    expect(parseRampType('Manual Fold-In Ramp')).toBe('fold_in')
    expect(parseRampType('In-Floor Power Ramp')).toBe('in_floor')
  })

  it('returns unknown for a generic description like "Manual Ramp" or "Power Lift"', () => {
    expect(parseRampType('Manual Ramp')).toBe('unknown')
    expect(parseRampType('Power Lift')).toBe('unknown')
    expect(parseRampType(null)).toBe('unknown')
  })
})

describe('parseConversionManufacturer', () => {
  it('maps known abbreviations to canonical brand names', () => {
    expect(parseConversionManufacturer('Braun')).toBe('BraunAbility')
    expect(parseConversionManufacturer('VMI')).toBe('VMI')
    expect(parseConversionManufacturer('AMS Vans')).toBe('AMS Vans')
  })

  it('returns null for an unrecognized or empty value rather than guessing', () => {
    expect(parseConversionManufacturer('FMI')).toBeNull()
    expect(parseConversionManufacturer('')).toBeNull()
    expect(parseConversionManufacturer(null)).toBeNull()
  })
})

// ─── buildListing ─────────────────────────────────────────────────────────────

const validRecord: ClassifiedRecord = {
  vin: '2C4RDGBG8CR297107',
  zip: '92345',
  price: 24999,
  year: 2012,
  make: 'Dodge',
  model: 'Grand Caravan',
  trim: 'LE',
  mileage: 89912,
  transmission: 'Automatic',
  color: 'Charcoal gray',
  details: 'Rear entry Wheelchair Van',
  images: [
    '//d2fvmu12dwd1j3.cloudfront.net/imgs/cl-uploads/a.jpg',
    '//d2fvmu12dwd1j3.cloudfront.net/imgs/cl-uploads/icon-logo.jpg',
  ],
  conv_make: 'Braun',
  conv_location: 'Rear',
  conv_type: 'Manual Ramp',
  conv_wheelchairs: 1,
  approved: 1,
  deleted: 0,
  last_updated: Math.floor(Date.now() / 1000), // just updated — not stale
}

const detailUrl = 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107'

describe('buildListing', () => {
  it('builds a complete private-seller listing from a valid record', () => {
    const result = buildListing(validRecord, detailUrl)
    expect(result).not.toBeNull()
    expect(result!.sourceId).toBe('ams-vans-classifieds')
    expect(result!.sourceUrl).toBe(detailUrl)
    expect(result!.buyerUrl).toBe(detailUrl)
    expect(result!.vin).toBe('2C4RDGBG8CR297107')
    expect(result!.make).toBe('Dodge')
    expect(result!.model).toBe('Grand Caravan')
    expect(result!.year).toBe(2012)
    expect(result!.trim).toBe('LE')
    expect(result!.condition).toBe('used')
    expect(result!.sellerType).toBe('private')
    expect(result!.priceCents).toBe(2499900)
    expect(result!.mileage).toBe(89912)
    expect(result!.wav.conversionType).toBe('rear_entry')
    expect(result!.wav.conversionManufacturer).toBe('BraunAbility')
    expect(result!.wav.wheelchairCapacity).toBe(1)
    expect(result!.location.zip).toBe('92345')
    expect(result!.dealer).toEqual({ name: null, phone: null, website: null })
    expect(result!.description).toBe('Rear entry Wheelchair Van')
    expect(result!.saleStatus).toBe('active')
    expect(result!.sourceUpdatedAt).toBeInstanceOf(Date)
  })

  it('never carries owner_email or any seller-identity field', () => {
    const result = buildListing(validRecord, detailUrl)
    expect(JSON.stringify(result)).not.toContain('@')
  })

  it('filters out a non-vehicle image (e.g. a logo) via the shared image filter', () => {
    const result = buildListing(validRecord, detailUrl)
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0]).toBe('https://d2fvmu12dwd1j3.cloudfront.net/imgs/cl-uploads/a.jpg')
  })

  it('returns null for a record that is not approved', () => {
    expect(buildListing({ ...validRecord, approved: 0 }, detailUrl)).toBeNull()
  })

  it('returns null for a record marked deleted', () => {
    expect(buildListing({ ...validRecord, deleted: 1 }, detailUrl)).toBeNull()
  })

  it('stores null VIN and unparseable_vin code for a garbage VIN', () => {
    const result = buildListing({ ...validRecord, vin: 'TOOSHORT' }, detailUrl)
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })

  it('stores VIN and invalid_check_digit code when the check digit fails', () => {
    const result = buildListing({ ...validRecord, vin: '2C4RDGBG8CR297106' }, detailUrl)
    expect(result).not.toBeNull()
    expect(result!.qualityIssueCodes).toContain('invalid_check_digit')
  })

  it('maps last_updated to sourceUpdatedAt regardless of age (no staleness inference)', () => {
    const twoYearsAgo = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 730
    const result = buildListing({ ...validRecord, last_updated: twoYearsAgo }, detailUrl)
    expect(result).not.toBeNull()
    expect(result!.saleStatus).toBe('active')
    expect(result!.sourceUpdatedAt).toEqual(new Date(twoYearsAgo * 1000))
  })

  it('treats a zero price as absent rather than a real $0 listing', () => {
    const result = buildListing({ ...validRecord, price: 0 }, detailUrl)
    expect(result!.priceCents).toBeNull()
  })

  it('treats zero wheelchair capacity as unknown rather than zero', () => {
    const result = buildListing({ ...validRecord, conv_wheelchairs: 0 }, detailUrl)
    expect(result!.wav.wheelchairCapacity).toBeNull()
  })

  it('falls back to normalized sourceUrl for sourceRecordKey when the VIN is unusable', () => {
    const result = buildListing({ ...validRecord, vin: 'TOOSHORT' }, detailUrl)
    expect(result!.sourceRecordKey).toBe(normalizeSourceUrl(detailUrl))
  })
})

// ─── hashPage1Entries ─────────────────────────────────────────────────────────

describe('hashPage1Entries', () => {
  it('changes when the VIN set changes', () => {
    const before = hashPage1Entries(['VIN1', 'VIN2'])
    const after = hashPage1Entries(['VIN1', 'VIN3'])
    expect(after).not.toBe(before)
  })

  it('is order-independent', () => {
    expect(hashPage1Entries(['a', 'b'])).toBe(hashPage1Entries(['b', 'a']))
  })
})

// ─── AmsVansClassifiedsAdapter.checkPage1 ────────────────────────────────────

describe('AmsVansClassifiedsAdapter.checkPage1', () => {
  it('reports unchanged when the sitemap VIN set matches the previous hash', async () => {
    const vins = extractClassifiedVinsFromSitemap(sitemapV1Xml)
    const previousHash = hashPage1Entries(vins)
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { previousPage1Hash: previousHash, fetchPage, robotsCache: allowAllRobots })
    const result = await adapter.checkPage1()
    expect(result.changed).toBe(false)
  })

  it('reports changed on first run (no previous hash)', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    const result = await adapter.checkPage1()
    expect(result.changed).toBe(true)
  })
})

// ─── AmsVansClassifiedsAdapter.checkStructure ────────────────────────────────

describe('AmsVansClassifiedsAdapter.checkStructure', () => {
  it('reports unchanged when the cl record schema matches the previous hash', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4RDGBG8CR297107': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107',
        status: 200,
        text: detailV1Html,
      },
    })
    const baseline = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    const baselineHash = (await baseline.checkStructure()).currentHash

    const adapter = new AmsVansClassifiedsAdapter(baselineHash, { fetchPage, robotsCache: allowAllRobots })
    const result = await adapter.checkStructure()
    expect(result.changed).toBe(false)
    expect(result.currentHash).toBe(baselineHash)
  })

  it('reports changed and includes sampleHtml when a field is renamed', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4RDGBG8CR297107': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107',
        status: 200,
        text: detailV2RenamedFieldHtml,
      },
    })
    const staleHash = 'a'.repeat(64)
    const adapter = new AmsVansClassifiedsAdapter(staleHash, { fetchPage, robotsCache: allowAllRobots })
    const result = await adapter.checkStructure()
    expect(result.changed).toBe(true)
    expect(result.currentHash).not.toBe(staleHash)
    expect(result.sampleHtml).toContain('conv_capacity')
  })

  it('reports unchanged when there is no previous hash yet (first run)', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4RDGBG8CR297107': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107',
        status: 200,
        text: detailV1Html,
      },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    const result = await adapter.checkStructure()
    expect(result.changed).toBe(false)
    expect(result.previousHash).toBeNull()
  })
})

// ─── AmsVansClassifiedsAdapter.scrape ─────────────────────────────────────────

describe('AmsVansClassifiedsAdapter.scrape', () => {
  it('discovers VINs from the sitemap and returns a listing per classified ad', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4RDGBG8CR297107': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107',
        status: 200,
        text: detailV1Html,
      },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4GP54L75R314298': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4GP54L75R314298',
        status: 404,
        text: '',
      },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots, detailFetchDelayMs: 0 })
    const result = await adapter.scrape()

    expect(result.listings).toHaveLength(1)
    expect(result.listings[0]!.vin).toBe('2C4RDGBG8CR297107')
    expect(result.fingerprintHash).toBeTruthy()
  })

  it('skips a detail fetch when robots.txt disallows it, without throwing', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4GP54L75R314298': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4GP54L75R314298',
        status: 200,
        text: detailV1Html.replace('2C4RDGBG8CR297107', '2C4GP54L75R314298'),
      },
    })
    const robotsCache = {
      async isAllowed(url: string): Promise<boolean> {
        return !url.includes('2C4RDGBG8CR297107')
      },
      clear(): void {},
    } as unknown as RobotsCache

    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache, detailFetchDelayMs: 0 })
    const result = await adapter.scrape()

    // Only the allowed VIN's detail page was fetched/parsed.
    expect(result.listings).toHaveLength(1)
  })

  it('respects maxListings for a bounded scrape', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
      'https://www.amsvans.com/wheelchair-vans/classifieds/2C4RDGBG8CR297107': {
        url: 'https://www.amsvans.com/wheelchair-vans/cl/2C4RDGBG8CR297107',
        status: 200,
        text: detailV1Html,
      },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots, detailFetchDelayMs: 0, maxListings: 1 })
    const result = await adapter.scrape()
    expect(result.listings).toHaveLength(1)
  })

  // This board reliably lists ~200 live classified ads, so a sitemap parsed
  // down to zero classifieds URLs is treated as a signal (a transient error
  // page, a redirect to a login/interstitial page, an upstream layout
  // change), not as genuine emptiness — scrape() must throw rather than
  // report a "complete" zero-listing crawl, which would otherwise cause the
  // engine to mark every existing listing gone (see ScraperEngine.runSource's
  // markGone call).
  it('throws rather than returning an empty listing array when the sitemap has no classifieds', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: '<urlset></urlset>' },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    await expect(adapter.scrape()).rejects.toThrow('zero classified-ad URLs')
  })

  it('throws when the sitemap fetch returns a non-200 status', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 500, text: '' },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    await expect(adapter.scrape()).rejects.toThrow('HTTP 500')
  })

  it('throws rather than silently discovering nothing when robots.txt disallows the sitemap', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: sitemapV1Xml },
    })
    const robotsCache = { isAllowed: async () => false, clear(): void {} } as unknown as RobotsCache
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache })
    await expect(adapter.scrape()).rejects.toThrow('robots.txt disallows')
  })

  it('checkPage1 also propagates a sitemap discovery failure rather than reporting unchanged', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: '<urlset></urlset>' },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    await expect(adapter.checkPage1()).rejects.toThrow('zero classified-ad URLs')
  })

  it('checkStructure also propagates a sitemap discovery failure', async () => {
    const fetchPage = fakeFetchPage({
      'https://www.amsvans.com/sitemap.xml': { url: 'https://www.amsvans.com/sitemap.xml', status: 200, text: '<urlset></urlset>' },
    })
    const adapter = new AmsVansClassifiedsAdapter(null, { fetchPage, robotsCache: allowAllRobots })
    await expect(adapter.checkStructure()).rejects.toThrow('zero classified-ad URLs')
  })
})
