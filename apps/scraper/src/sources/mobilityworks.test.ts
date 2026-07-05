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
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse } from '../browser/types.js'

// ─── Mock browser service helpers ────────────────────────────────────────────

/**
 * Build a minimal BrowserPage mock.
 * - `gotoErrors`: map of URL substrings → error to throw on goto().
 * - `evaluateResults`: queue of return values for successive evaluate() calls.
 *   When the queue is empty, evaluate() returns [].
 */
function makePage(
  gotoErrors: Record<string, Error> = {},
  evaluateResults: unknown[] = [],
): BrowserPage {
  let evalIndex = 0
  return {
    async goto(url: string): Promise<BrowserResponse | null> {
      for (const [fragment, err] of Object.entries(gotoErrors)) {
        if (url.includes(fragment)) throw err
      }
      return { status: () => 200 }
    },
    async setContent(): Promise<void> {},
    async content(): Promise<string> { return '' },
    url(): string { return '' },
    evaluate<T>(): Promise<T> {
      const result = evalIndex < evaluateResults.length
        ? evaluateResults[evalIndex++]
        : []
      return Promise.resolve(result as unknown as T)
    },
    async waitForSelector(): Promise<void> {},
    async close(): Promise<void> {},
  }
}

function makeService(
  gotoErrors: Record<string, Error> = {},
  evaluateResults: unknown[] = [],
): BrowserService {
  return {
    async launch(): Promise<BrowserSession> {
      const page = makePage(gotoErrors, evaluateResults)
      return {
        newPage: async () => page,
        async close(): Promise<void> {},
      }
    },
  }
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

// ─── MobilityWorksAdapter.checkPage1 retry behaviour ────────────────────────

describe('MobilityWorksAdapter.checkPage1 timeout retry', () => {
  it('succeeds and returns a hash when the first goto times out but the second succeeds', async () => {
    let gotoAttempts = 0
    // Build a service where the first goto throws a timeout, the second succeeds.
    const service: BrowserService = {
      async launch(): Promise<BrowserSession> {
        return {
          async newPage(): Promise<BrowserPage> {
            return {
              async goto(): Promise<BrowserResponse | null> {
                gotoAttempts++
                if (gotoAttempts === 1) {
                  throw new Error('page.goto: Timeout 30000ms exceeded.')
                }
                return { status: () => 200 }
              },
              async setContent(): Promise<void> {},
              async content(): Promise<string> { return '' },
              url(): string { return '' },
              evaluate<T>(): Promise<T> { return Promise.resolve([] as unknown as T) },
              async waitForSelector(): Promise<void> {},
              async close(): Promise<void> {},
            }
          },
          async close(): Promise<void> {},
        }
      },
    }

    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    const result = await adapter.checkPage1()

    expect(gotoAttempts).toBe(2)
    expect(result).toMatchObject({
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      changed: expect.any(Boolean),
    })
  })

  it('rethrows after exhausting all retry attempts', async () => {
    const service = makeService({ 'mobilityworks.com': new Error('page.goto: Timeout 30000ms exceeded.') })
    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    await expect(adapter.checkPage1()).rejects.toThrow('Timeout 30000ms exceeded')
  })

  it('re-throws non-timeout errors immediately without retrying', async () => {
    const service = makeService({ 'mobilityworks.com': new Error('net::ERR_CONNECTION_REFUSED') })
    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    await expect(adapter.checkPage1()).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })
})

// ─── MobilityWorksAdapter.checkStructure retry behaviour ─────────────────────

describe('MobilityWorksAdapter.checkStructure timeout retry', () => {
  it('succeeds and returns a hash when the first goto times out but the second succeeds', async () => {
    let gotoAttempts = 0
    const service: BrowserService = {
      async launch(): Promise<BrowserSession> {
        return {
          async newPage(): Promise<BrowserPage> {
            return {
              async goto(): Promise<BrowserResponse | null> {
                gotoAttempts++
                if (gotoAttempts === 1) {
                  throw new Error('page.goto: Timeout 30000ms exceeded.')
                }
                return { status: () => 200 }
              },
              async setContent(): Promise<void> {},
              async content(): Promise<string> { return '' },
              url(): string { return '' },
              evaluate<T>(): Promise<T> { return Promise.resolve({ signature: 'no-listings', cardHtml: '' } as unknown as T) },
              async waitForSelector(): Promise<void> {},
              async close(): Promise<void> {},
            }
          },
          async close(): Promise<void> {},
        }
      },
    }

    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    const result = await adapter.checkStructure()

    expect(gotoAttempts).toBe(2)
    expect(result).toMatchObject({
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      changed: expect.any(Boolean),
    })
  })

  it('rethrows after exhausting all retry attempts', async () => {
    const service = makeService({ 'mobilityworks.com': new Error('page.goto: Timeout 30000ms exceeded.') })
    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    await expect(adapter.checkStructure()).rejects.toThrow('Timeout 30000ms exceeded')
  })
})

// ─── MobilityWorksAdapter.scrape pagination timeout behaviour ────────────────

describe('MobilityWorksAdapter.scrape pagination timeout', () => {
  it('stops pagination and returns gathered listings when page > 1 times out', async () => {
    // A raw card that parseCard can successfully parse into a Listing
    const card: RawCard = {
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

    let gotoCount = 0
    // evaluate is called in order: (1) cards for page 1, (2) hasNext for page 1
    const evaluateQueue: unknown[] = [
      [card],  // page 1 cards
      true,    // hasNext = page 2 exists
    ]
    let evalIndex = 0

    const service: BrowserService = {
      async launch(): Promise<BrowserSession> {
        return {
          async newPage(): Promise<BrowserPage> {
            return {
              async goto(url: string): Promise<BrowserResponse | null> {
                gotoCount++
                if (url.includes('/page/2/')) {
                  throw new Error('page.goto: Timeout 30000ms exceeded.')
                }
                return { status: () => 200 }
              },
              async setContent(): Promise<void> {},
              async content(): Promise<string> { return '' },
              url(): string { return '' },
              evaluate<T>(): Promise<T> {
                const result = evalIndex < evaluateQueue.length
                  ? evaluateQueue[evalIndex++]
                  : []
                return Promise.resolve(result as unknown as T)
              },
              async waitForSelector(): Promise<void> {},
              async close(): Promise<void> {},
            }
          },
          async close(): Promise<void> {},
        }
      },
    }

    const adapter = new MobilityWorksAdapter(null, { browserService: service, maxPages: 5, navRetryBackoffMs: 0 })
    const result = await adapter.scrape()

    // Should not throw — pagination stopped gracefully on page 2 timeout
    expect(result.listings).toHaveLength(1)
    expect(result.listings[0]!.vin).toBe('5TDYRKEC8RS205440')
    expect(gotoCount).toBe(2) // page 1 + page 2 (which timed out)
  })

  it('rethrows a timeout on page 1 (no partial listings to return)', async () => {
    const service = makeService({ 'wheelchair-vans-for-sale/': new Error('page.goto: Timeout 30000ms exceeded.') })
    // All 3 retry attempts exhaust before throwing
    const adapter = new MobilityWorksAdapter(null, { browserService: service, navRetryBackoffMs: 0 })
    await expect(adapter.scrape()).rejects.toThrow('Timeout 30000ms exceeded')
  })
})
