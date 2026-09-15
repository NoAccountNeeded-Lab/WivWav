import { describe, it, expect } from 'vitest'
import {
  parseMileage,
  parsePrice,
  parseConversionType,
  parseRampType,
  parseLocation,
  parseCard,
  MobilityWorksAdapter,
} from './mobilityworks.js'
import type { RawCard } from './mobilityworks.js'
import { createRequire } from 'node:module'
import type { CrawledHtmlPage, CrawleeHtmlFetcher, CrawledHtmlPageHandler } from '../crawlee/html-fetcher.js'

const require = createRequire(import.meta.url)
const cheerio = require('cheerio') as { load(html: string): CrawledHtmlPage['$'] }

function pageFromHtml(url: string, html: string): CrawledHtmlPage {
  return { url, body: html, $: cheerio.load(html) }
}

// ─── parseMileage ────────────────────────────────────────────────────────────

describe('parseMileage', () => {
  it('parses numeric mileage without commas', () => {
    expect(parseMileage('50094')).toBe(50094)
    expect(parseMileage('1234')).toBe(1234)
  })

  it('parses comma-formatted mileage', () => {
    expect(parseMileage('50,094')).toBe(50094)
  })

  it('returns null for empty or non-numeric input', () => {
    expect(parseMileage('')).toBeNull()
    expect(parseMileage('N/A')).toBeNull()
  })
})

// ─── parsePrice ──────────────────────────────────────────────────────────────

describe('parsePrice', () => {
  it('converts dollar amount to cents', () => {
    expect(parsePrice('$71,991')).toBe(7199100)
    expect(parsePrice('$1,000')).toBe(100000)
  })

  it('handles price without dollar sign', () => {
    expect(parsePrice('71991')).toBe(7199100)
  })

  it('returns null for "Call for Price" and empty strings', () => {
    expect(parsePrice('Call for Price')).toBeNull()
    expect(parsePrice('')).toBeNull()
  })

  it('parses price correctly after <sup> footnote elements are stripped from the DOM', () => {
    // MobilityWorks renders "$71,991<sup>1</sup>"; the scraper clones and removes <sup> before
    // reading textContent, so parsePrice receives the clean "$71,991" string.
    // Before the fix, textContent was "$71,9911" which parsed to 71991100 (wrong).
    expect(parsePrice('$71,991')).toBe(7199100)
  })
})

// ─── parseConversionType ─────────────────────────────────────────────────────

describe('parseConversionType', () => {
  it('detects rear entry', () => {
    expect(parseConversionType('Rear Entry Manual Fold Out')).toBe('rear_entry')
    expect(parseConversionType('rear-entry conversion')).toBe('rear_entry')
  })

  it('detects side entry', () => {
    expect(parseConversionType('Side Entry In-Floor')).toBe('side_entry')
    expect(parseConversionType('side-entry van')).toBe('side_entry')
  })

  it('returns unknown for unrecognized text', () => {
    expect(parseConversionType('')).toBe('unknown')
    expect(parseConversionType('Wheelchair Van Conversion')).toBe('unknown')
  })
})

// ─── parseRampType ───────────────────────────────────────────────────────────

describe('parseRampType', () => {
  it('detects fold out ramp', () => {
    expect(parseRampType('Rear Entry Manual Fold Out')).toBe('fold_out')
    expect(parseRampType('fold-out ramp')).toBe('fold_out')
  })

  it('detects in-floor ramp', () => {
    expect(parseRampType('Rear Entry In-Floor')).toBe('in_floor')
    expect(parseRampType('Side Entry In Floor Ramp')).toBe('in_floor')
    expect(parseRampType('Infloor conversion')).toBe('in_floor')
  })

  it('detects fold-in ramp', () => {
    expect(parseRampType('Fold In Ramp')).toBe('fold_in')
    expect(parseRampType('fold-in conversion')).toBe('fold_in')
  })

  it('returns unknown for unrecognized text', () => {
    expect(parseRampType('')).toBe('unknown')
    expect(parseRampType('Manual Ramp')).toBe('unknown')
  })
})

// ─── parseLocation ───────────────────────────────────────────────────────────

describe('parseLocation', () => {
  it('parses multi-word city and two-letter state code', () => {
    const result = parseLocation('North Las Vegas NV')
    expect(result.city).toBe('North Las Vegas')
    expect(result.state).toBe('NV')
  })

  it('parses single-word city', () => {
    const result = parseLocation('Columbus OH')
    expect(result.city).toBe('Columbus')
    expect(result.state).toBe('OH')
  })

  it('returns city and null state when no state code found', () => {
    const result = parseLocation('North Las Vegas')
    expect(result.city).toBe('North Las Vegas')
    expect(result.state).toBeNull()
  })

  it('returns null city for empty string', () => {
    const result = parseLocation('')
    expect(result.city).toBeNull()
    expect(result.state).toBeNull()
  })

  it('strips market suffix parenthetical and trailing field bleed', () => {
    // When the DOM has no newlines between card fields, the location text can bleed
    // into adjacent fields: "South Salt Lake UT (Salt Lake City) Stock: TR218378 Request Information Schedule a Test Drive"
    const result = parseLocation('South Salt Lake UT (Salt Lake City) Stock: TR218378 Request Information Schedule a Test Drive')
    expect(result.city).toBe('South Salt Lake')
    expect(result.state).toBe('UT')
  })

  it('strips market suffix parenthetical alone', () => {
    const result = parseLocation('North Las Vegas NV (Las Vegas)')
    expect(result.city).toBe('North Las Vegas')
    expect(result.state).toBe('NV')
  })
})

// ─── parseCard ───────────────────────────────────────────────────────────────

const validCard: RawCard = {
  href: '/wheelchair-vans-for-sale/2024-toyota-sienna-driverge-5tdyrkec8rs205440/',
  title: 'Used 2024 Toyota Sienna FWD XLE (New Conversion)',
  price: '$71,991',
  stock: 'RS205440',
  mileage: '50094',
  color: 'Grey',
  convMake: 'Driverge',
  conversion: 'Rear Entry Manual Fold Out',
  location: 'North Las Vegas NV',
  imageUrl: 'https://s3.amazonaws.com/vehicle-images/abc123.jpg',
}

describe('parseCard', () => {
  it('parses a complete valid card', () => {
    const result = parseCard(validCard)
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Toyota')
    expect(result!.model).toBe('Sienna')
    expect(result!.year).toBe(2024)
    expect(result!.trim).toBe('FWD XLE')
    expect(result!.vin).toBe('5TDYRKEC8RS205440')
    expect(result!.condition).toBe('used')
    expect(result!.mileage).toBe(50094)
    expect(result!.priceCents).toBe(7199100)
    expect(result!.color).toBe('Grey')
    expect(result!.location.city).toBe('North Las Vegas')
    expect(result!.location.state).toBe('NV')
    expect(result!.wav.conversionType).toBe('rear_entry')
    expect(result!.wav.conversionManufacturer).toBe('Driverge')
    expect(result!.wav.rampType).toBe('fold_out')
    expect(result!.sourceId).toBe('mobilityworks')
    expect(result!.sourceUrl).toContain('5tdyrkec8rs205440')
    expect(result!.externalId).toBe('RS205440')
  })

  it('sets condition to "new" for new vehicles', () => {
    const result = parseCard({ ...validCard, title: 'New 2024 Toyota Sienna FWD XLE' })
    expect(result!.condition).toBe('new')
  })

  it('strips trailing parenthetical from title before parsing', () => {
    const result = parseCard({ ...validCard, title: 'Used 2024 Toyota Sienna FWD XLE (New Conversion)' })
    expect(result!.trim).toBe('FWD XLE')
  })

  it('returns null when VIN is not 17 alphanumeric chars', () => {
    expect(parseCard({ ...validCard, href: '/wheelchair-vans-for-sale/2024-toyota-sienna-TOOSHORT/' })).toBeNull()
    expect(parseCard({ ...validCard, href: '/wheelchair-vans-for-sale/' })).toBeNull()
  })

  it('returns null when make or model cannot be parsed', () => {
    expect(parseCard({ ...validCard, title: '' })).toBeNull()
    expect(parseCard({ ...validCard, title: 'Used 2024' })).toBeNull()
  })

  it('returns null for implausible years', () => {
    expect(parseCard({ ...validCard, title: 'Used 1985 Toyota Sienna FWD XLE' })).toBeNull()
    expect(parseCard({ ...validCard, title: 'Used 2099 Toyota Sienna FWD XLE' })).toBeNull()
  })

  it('handles "Call for Price" gracefully', () => {
    const result = parseCard({ ...validCard, price: 'Call for Price' })
    expect(result).not.toBeNull()
    expect(result!.priceCents).toBeNull()
  })

  it('handles missing mileage gracefully', () => {
    const result = parseCard({ ...validCard, mileage: '' })
    expect(result).not.toBeNull()
    expect(result!.mileage).toBeNull()
  })

  it('includes the thumbnail image', () => {
    const result = parseCard(validCard)
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0]).toContain('abc123')
  })

  it('sets externalId from stock number', () => {
    const result = parseCard(validCard)
    expect(result!.externalId).toBe('RS205440')
  })

  it('falls back to VIN as externalId when stock is empty', () => {
    const result = parseCard({ ...validCard, stock: '' })
    expect(result!.externalId).toBe('5TDYRKEC8RS205440')
  })

  it('sets sourceRecordKey to stock number when present', () => {
    const result = parseCard(validCard)
    expect(result!.sourceRecordKey).toBe('RS205440')
  })

  it('sets sourceRecordKey to VIN when stock is empty', () => {
    const result = parseCard({ ...validCard, stock: '' })
    expect(result!.sourceRecordKey).toBe('5TDYRKEC8RS205440')
  })

  it('uppercases the VIN from the URL slug', () => {
    const result = parseCard(validCard)
    expect(result!.vin).toBe('5TDYRKEC8RS205440')
  })

  it('sets dealer name to MobilityWorks', () => {
    const result = parseCard(validCard)
    expect(result!.dealer.name).toBe('MobilityWorks')
  })

  // ─── Multi-word model titles (refs #618) ────────────────────────────────────
  // The tokenizer used to assume `model` was always exactly one token, which
  // truncated multi-word models and dumped the rest into `trim`.

  it('parses "Town & Country" as the full model, not just "Town"', () => {
    const result = parseCard({ ...validCard, title: 'Used 2024 Chrysler Town & Country Touring' })
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Chrysler')
    expect(result!.model).toBe('Town & Country')
    expect(result!.trim).toBe('Touring')
  })

  it('parses "Grand Caravan" as the full model, not just "Grand"', () => {
    const result = parseCard({ ...validCard, title: 'Used 2019 Dodge Grand Caravan SXT' })
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Dodge')
    expect(result!.model).toBe('Grand Caravan')
    expect(result!.trim).toBe('SXT')
  })
})

// ─── MobilityWorksAdapter Crawlee fetcher integration ───────────────────────

const cardHtml = `
  <article class="inventory-card">
    <a href="/wheelchair-vans-for-sale/2024-toyota-sienna-driverge-5tdyrkec8rs205440/">
      <h3>Used 2024 Toyota Sienna FWD XLE (New Conversion)</h3>
    </a>
    <img src="/images/sienna.jpg" alt="">
    <p>Price: $71,991</p>
    <p>Stock: RS205440</p>
    <p>Mileage: 50,094</p>
    <p>Color: Grey</p>
    <p>Conv Make: Driverge</p>
    <p>Conversion: Rear Entry Manual Fold Out</p>
    <p>Location: North Las Vegas NV</p>
  </article>
`

class FakeHtmlFetcher implements CrawleeHtmlFetcher {
  readonly requestedUrls: string[] = []
  private readonly pages: Map<string, CrawledHtmlPage>
  private readonly errors: Map<string, Error>

  constructor(pages: Record<string, string>, errors: Record<string, Error> = {}) {
    this.pages = new Map(
      Object.entries(pages).map(([url, html]) => [url, pageFromHtml(url, html)]),
    )
    this.errors = new Map(Object.entries(errors))
  }

  async crawl(urls: string[], handler: CrawledHtmlPageHandler): Promise<void> {
    for (const url of urls) {
      await handler(await this.fetchOne(url))
    }
  }

  async fetchOne(url: string): Promise<CrawledHtmlPage> {
    this.requestedUrls.push(url)
    const error = this.errors.get(url)
    if (error) throw error
    const page = this.pages.get(url)
    if (!page) throw new Error(`Missing fake page for ${url}`)
    return page
  }
}

describe('MobilityWorksAdapter with Crawlee HTML fetcher', () => {
  it('checkPage1 hashes listing VIN and price from Crawlee-fetched HTML', async () => {
    const fetcher = new FakeHtmlFetcher({
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/?sortby=yearnew': cardHtml,
    })
    const adapter = new MobilityWorksAdapter(null, { htmlFetcher: fetcher })

    const result = await adapter.checkPage1()

    expect(fetcher.requestedUrls).toEqual([
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/?sortby=yearnew',
    ])
    expect(result).toMatchObject({
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      changed: true,
    })
  })

  it('checkStructure returns a scoped sample when the card signature changes', async () => {
    const fetcher = new FakeHtmlFetcher({
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/': cardHtml,
    })
    const adapter = new MobilityWorksAdapter('stale-hash', { htmlFetcher: fetcher })

    const result = await adapter.checkStructure()

    expect(result.changed).toBe(true)
    expect(result.sampleHtml).toContain('inventory-card')
    expect(result.currentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('scrapes paginated listing pages through the injected Crawlee fetcher', async () => {
    const page1 = `${cardHtml}<a href="/wheelchair-vans-for-sale/page/2/">2</a>`
    const page2 = cardHtml.replace('RS205440', 'RS205441').replace('5tdyrkec8rs205440', '5TDYRKEC8RS205441')
    const fetcher = new FakeHtmlFetcher({
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/': page1,
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/page/2/': page2,
    })
    const adapter = new MobilityWorksAdapter(null, { htmlFetcher: fetcher, maxPages: 5 })

    const result = await adapter.scrape()

    expect(fetcher.requestedUrls).toEqual([
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/',
      'https://www.mobilityworks.com/wheelchair-vans-for-sale/page/2/',
    ])
    expect(result.listings).toHaveLength(2)
    expect(result.listings.map((listing) => listing.stockNumber)).toEqual(['RS205440', 'RS205441'])
  })

  it('propagates first-page fetch failures without returning partial listings', async () => {
    const error = new Error('Crawlee request failed')
    const fetcher = new FakeHtmlFetcher(
      {},
      { 'https://www.mobilityworks.com/wheelchair-vans-for-sale/': error },
    )
    const adapter = new MobilityWorksAdapter(null, { htmlFetcher: fetcher })

    await expect(adapter.scrape()).rejects.toThrow('Crawlee request failed')
  })
})
