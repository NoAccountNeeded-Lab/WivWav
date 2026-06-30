import { describe, it, expect, vi } from 'vitest'

// Mock @wivwav/db so unit tests run without a built dist or live database.
// The VIN implementations here match packages/db/src/lib/vin.ts exactly.
vi.mock('@wivwav/db', () => {
  const TRANSLITERATION: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5,         P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  }
  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

  function normalizeVin(raw: string): string {
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  }
  function isValidVin(vin: string): boolean {
    if (vin.length !== 17) return false
    if (/[IOQ]/.test(vin)) return false
    return true
  }
  function checkDigitValid(vin: string): boolean {
    if (vin.length !== 17) return false
    let sum = 0
    for (let i = 0; i < 17; i++) {
      const val = TRANSLITERATION[vin[i]!]
      if (val === undefined) return false
      sum += val * WEIGHTS[i]!
    }
    const remainder = sum % 11
    const expected = remainder === 10 ? 'X' : String(remainder)
    return vin[8] === expected
  }
  return { normalizeVin, isValidVin, checkDigitValid }
})

import {
  parseMileage,
  parsePrice,
  parseConversionType,
  parseConversionManufacturer,
  parseCard,
  hashPage1Entries,
  isNavigationTimeout,
  BlvdAdapter,
} from './blvd.js'
import type { RawCard } from './blvd.js'
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse, NewPageOptions } from '../browser/types.js'
import type { RobotsCache } from '../util/robots-cache.js'

// Minimal browser service factory for checkPage1 unit tests.
// `gotoErrors` maps URL substrings to errors that goto() should throw.
// evaluate() always returns [] (no DOM needed — checkPage1 only needs a hash).
function makeTimeoutService(gotoErrors: Record<string, Error> = {}): BrowserService {
  function makePage(): BrowserPage {
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
      evaluate<T>(): Promise<T> { return Promise.resolve([] as unknown as T) },
      async waitForSelector(): Promise<void> {},
      async close(): Promise<void> {},
    }
  }
  return {
    async launch(): Promise<BrowserSession> {
      return {
        newPage: async () => makePage(),
        async close(): Promise<void> {},
      }
    },
  }
}

// ─── parseMileage ────────────────────────────────────────────────────────────

describe('parseMileage', () => {
  it('parses comma-formatted mileage', () => {
    expect(parseMileage('50,094')).toBe(50094)
    expect(parseMileage('1,234,567')).toBe(1234567)
  })

  it('parses mileage without commas', () => {
    expect(parseMileage('12000')).toBe(12000)
  })

  it('returns null for empty or non-numeric input', () => {
    expect(parseMileage('')).toBeNull()
    expect(parseMileage('N/A')).toBeNull()
    expect(parseMileage('Call')).toBeNull()
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

  it('returns null for "Call" and empty strings', () => {
    expect(parsePrice('Call')).toBeNull()
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('Call for Price')).toBeNull()
  })
})

// ─── parseConversionType ─────────────────────────────────────────────────────

describe('parseConversionType', () => {
  it('detects rear entry', () => {
    expect(parseConversionType('Rear Entry Wheelchair Van Conversion')).toBe('rear_entry')
    expect(parseConversionType('VMI Rear-Entry Northstar')).toBe('rear_entry')
    expect(parseConversionType('rear entry van')).toBe('rear_entry')
  })

  it('detects side entry', () => {
    expect(parseConversionType('Side Entry Conversion')).toBe('side_entry')
    expect(parseConversionType('BraunAbility Side-Entry')).toBe('side_entry')
  })

  it('returns unknown when entry type is not mentioned', () => {
    expect(parseConversionType('Driverge Flex Maxx Wheelchair Van Conversion')).toBe('unknown')
    expect(parseConversionType('')).toBe('unknown')
  })
})

// ─── parseConversionManufacturer ─────────────────────────────────────────────

describe('parseConversionManufacturer', () => {
  it('extracts the first word as the manufacturer', () => {
    expect(parseConversionManufacturer('Driverge Driverge Flex Maxx Wheelchair Van Conversion')).toBe('Driverge')
    expect(parseConversionManufacturer('BraunAbility Side Entry')).toBe('BraunAbility')
    expect(parseConversionManufacturer('VMI Northstar')).toBe('VMI')
  })

  it('strips the "Wheelchair Van Conversion" suffix before extracting', () => {
    expect(parseConversionManufacturer('Rollx Wheelchair Van Conversion')).toBe('Rollx')
  })

  it('returns null for empty input', () => {
    expect(parseConversionManufacturer('')).toBeNull()
  })
})

// ─── parseCard ───────────────────────────────────────────────────────────────

const validCard: RawCard = {
  href: '/wheelchair-vans/mobilityworks-north-las-vegas-nv/5TDYRKEC8RS205440',
  fullTitle: '2024 Toyota Sienna FWD XLE',
  conversion: 'Driverge Driverge Flex Maxx Wheelchair Van Conversion',
  condition: 'Used',
  miles: '50,094',
  price: '$71,991',
  seller: 'MobilityWorks',
  location: 'North Las Vegas, NV',
  imageUrl: 'https://www.blvd.com/wheelchair-vans-dir/mobilityworks/5TDYRKEC8RS205440_89032_1_thumb.jpg',
  dataId: '159531',
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
    expect(result!.dealer.name).toBe('MobilityWorks')
    expect(result!.location.city).toBe('North Las Vegas')
    expect(result!.location.state).toBe('NV')
    expect(result!.sourceId).toBe('blvd')
    expect(result!.sourceUrl).toContain('5TDYRKEC8RS205440')
    expect(result!.buyerUrl).toBe(result!.sourceUrl)
    expect(result!.sellerType).toBe('dealer')
  })

  it('classifies BLVD for-sale-by-owner listings as private seller inventory', () => {
    const result = parseCard({ ...validCard, seller: 'For Sale By Owner' })

    expect(result).not.toBeNull()
    expect(result!.sellerType).toBe('private')
    expect(result!.dealer.name).toBe('For Sale By Owner')
    expect(result!.buyerUrl).toBe(result!.sourceUrl)
  })

  it('sets condition to "new" when vehicle condition is New', () => {
    const result = parseCard({ ...validCard, condition: 'New' })
    expect(result!.condition).toBe('new')
  })

  it('stores a listing with vin: null and qualityIssueCodes when VIN segment is too short', () => {
    const result = parseCard({ ...validCard, href: '/wheelchair-vans/dealer/TOOSHORT' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })

  it('returns null when href is empty (no identity for the listing)', () => {
    expect(parseCard({ ...validCard, href: '' })).toBeNull()
  })

  it('returns null when make or model cannot be parsed', () => {
    expect(parseCard({ ...validCard, fullTitle: '' })).toBeNull()
    expect(parseCard({ ...validCard, fullTitle: '2024' })).toBeNull()
  })

  it('returns null for implausible years', () => {
    expect(parseCard({ ...validCard, fullTitle: '1985 Toyota Sienna FWD XLE' })).toBeNull()
    expect(parseCard({ ...validCard, fullTitle: '2099 Toyota Sienna FWD XLE' })).toBeNull()
  })

  it('handles "Call" price gracefully', () => {
    const result = parseCard({ ...validCard, price: 'Call' })
    expect(result).not.toBeNull()
    expect(result!.priceCents).toBeNull()
  })

  it('handles missing mileage gracefully', () => {
    const result = parseCard({ ...validCard, miles: '' })
    expect(result).not.toBeNull()
    expect(result!.mileage).toBeNull()
  })

  it('includes the thumbnail image', () => {
    const result = parseCard(validCard)
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0]).toContain('5TDYRKEC8RS205440')
  })

  it('sets externalId from data-id attribute', () => {
    const result = parseCard(validCard)
    expect(result!.externalId).toBe('159531')
  })

  it('sets sourceRecordKey to externalId when data-id is present', () => {
    const result = parseCard(validCard)
    expect(result!.sourceRecordKey).toBe('159531')
  })

  it('falls back to normalized sourceUrl for sourceRecordKey when data-id is absent', () => {
    const result = parseCard({ ...validCard, dataId: '' })
    expect(result!.externalId).toBeNull()
    expect(result!.sourceRecordKey).toBe(result!.sourceUrl)
  })

  // ─── VIN normalization ───────────────────────────────────────────────────────

  it('normalizes a mixed-case VIN to uppercase', () => {
    const lowerCaseVin = validCard.href.toLowerCase()
    const result = parseCard({ ...validCard, href: lowerCaseVin })
    expect(result).not.toBeNull()
    expect(result!.vin).toBe('5TDYRKEC8RS205440')
    expect(result!.qualityIssueCodes).toBeUndefined()
  })

  it('stores a valid VIN without quality issue codes', () => {
    const result = parseCard(validCard)
    expect(result).not.toBeNull()
    expect(result!.vin).toBe('5TDYRKEC8RS205440')
    expect(result!.qualityIssueCodes).toBeUndefined()
  })

  it('stores null VIN and unparseable_vin code for a garbage string shorter than 17 chars', () => {
    // Simulates a URL segment like "VotedLowestPrices" (the real audit finding)
    const result = parseCard({ ...validCard, href: '/wheelchair-vans/dealer/VotedLowestPrices' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })

  it('stores null VIN and unparseable_vin code when VIN contains forbidden characters (I/O/Q)', () => {
    // 17 chars but contains forbidden character I → structurally invalid
    const result = parseCard({ ...validCard, href: '/wheelchair-vans/dealer/5TDYIKEC8RS205440' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })

  it('stores VIN and invalid_check_digit code when check-digit fails', () => {
    // Valid structure but wrong check digit: swap last char to break the check
    // 5TDYRKEC8RS205441 → check digit should be 8 not 1 → fails
    // Rule id matches listing-validator.ts's invalid_check_digit rule for the same condition.
    const result = parseCard({ ...validCard, href: '/wheelchair-vans/dealer/5TDYRKEC8RS205441' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBe('5TDYRKEC8RS205441')
    expect(result!.qualityIssueCodes).toContain('invalid_check_digit')
  })

  // ─── Condition parser ────────────────────────────────────────────────────────

  it('returns null when the condition selector is absent from the page (condition is empty string)', () => {
    const result = parseCard({ ...validCard, condition: '' })
    expect(result).toBeNull()
  })
})

describe('hashPage1Entries', () => {
  it('changes when FSBO page 1 entries change but dealer entries do not', () => {
    const dealerEntries = ['/wheelchair-vans-for-sale:dealer-1:$71,991']
    const previousHash = hashPage1Entries(dealerEntries)
    const currentHash = hashPage1Entries([
      ...dealerEntries,
      '/wheelchair-vans-for-sale-by-owner:fsbo-1:$55,000',
    ])

    expect(currentHash).not.toBe(previousHash)
  })

  it('keeps entries from different BLVD paths distinct when ids and prices match', () => {
    const dealerHash = hashPage1Entries(['/wheelchair-vans-for-sale:159531:$71,991'])
    const fsboHash = hashPage1Entries(['/wheelchair-vans-for-sale-by-owner:159531:$71,991'])

    expect(fsboHash).not.toBe(dealerHash)
  })
})

describe('isNavigationTimeout', () => {
  it('detects Playwright navigation timeout errors', () => {
    expect(isNavigationTimeout(new Error('page.goto: Timeout 30000ms exceeded.'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isNavigationTimeout(new Error('net::ERR_ABORTED'))).toBe(false)
    expect(isNavigationTimeout('Timeout 30000ms exceeded')).toBe(false)
  })
})

describe('BlvdAdapter.checkPage1 timeout handling', () => {
  it('returns a valid hash and does not throw when the FSBO path times out', async () => {
    const service = makeTimeoutService({
      'by-owner': new Error('page.goto: Timeout 30000ms exceeded.'),
    })
    const adapter = new BlvdAdapter(null, { browserService: service })

    await expect(adapter.checkPage1()).resolves.toMatchObject({
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      changed: expect.any(Boolean),
    })
  })

  it('re-throws non-timeout errors from goto', async () => {
    const service = makeTimeoutService({
      'by-owner': new Error('net::ERR_CONNECTION_REFUSED'),
    })
    const adapter = new BlvdAdapter(null, { browserService: service })

    await expect(adapter.checkPage1()).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })
})

// ─── BlvdAdapter.scrape robots.txt skip ─────────────────────────────────────

describe('BlvdAdapter.scrape robots.txt skip', () => {
  it('skips a listing path when robots.txt disallows it and logs the skip', async () => {
    const reportedMessages: string[] = []

    // Minimal browser service that records navigation calls but never returns cards
    function makeNoCardService(): BrowserService {
      return {
        async launch() {
          return {
            async newPage() {
              return {
                async goto(): Promise<{ status(): number }> { return { status: () => 200 } },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '<html></html>' },
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
    }

    // Stub that disallows /wheelchair-vans-for-sale but allows the FSBO path
    // Only isAllowed() is called during scrape.
    const robotsCache = {
      async isAllowed(url: string): Promise<boolean> {
        return !url.includes('/wheelchair-vans-for-sale')
      },
      clear(): void {},
    } as unknown as RobotsCache

    const adapter = new BlvdAdapter(null, {
      browserService: makeNoCardService(),
      robotsCache,
    })

    // Minimal job context — only log() is called by report()
    const context = {
      log: async (msg: string) => { reportedMessages.push(msg) },
      updateProgress: async () => {},
      logger: { info: () => {} },
    } as unknown as Parameters<typeof adapter.scrape>[0]

    // Should not throw — disallowed path is skipped, not aborted
    const result = await adapter.scrape(context)

    // The disallowed path should produce a skip log
    const skipLog = reportedMessages.find(m => m.includes('robots.txt disallows') && m.includes('/wheelchair-vans-for-sale'))
    expect(skipLog).toBeDefined()

    // Listings come from the FSBO path only (which returns [] in mock) — result still resolves
    expect(result.listings).toBeInstanceOf(Array)
  })
})

// ─── BlvdAdapter.scrape resource blocking ───────────────────────────────────

describe('BlvdAdapter.scrape resource blocking', () => {
  it('opens its page with image/media/font/stylesheet blocking', async () => {
    // Regression guard for #484: dropping blockResourceTypes here lets Chromium
    // accumulate subresource requests across listing pages until navigation
    // fails with net::ERR_INSUFFICIENT_RESOURCES.
    const newPageOptions: Array<NewPageOptions | undefined> = []

    function makeRecordingService(): BrowserService {
      return {
        async launch() {
          return {
            async newPage(options?: NewPageOptions) {
              newPageOptions.push(options)
              return {
                async goto(): Promise<{ status(): number }> { return { status: () => 200 } },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '<html></html>' },
                url(): string { return '' },
                // No cards → pagination stops after page 1 on each path.
                evaluate<T>(): Promise<T> { return Promise.resolve([] as unknown as T) },
                async waitForSelector(): Promise<void> {},
                async close(): Promise<void> {},
              }
            },
            async close(): Promise<void> {},
          }
        },
      }
    }

    const robotsCache = {
      async isAllowed(): Promise<boolean> { return true },
      clear(): void {},
    } as unknown as RobotsCache

    const adapter = new BlvdAdapter(null, {
      browserService: makeRecordingService(),
      robotsCache,
    })

    await adapter.scrape()

    expect(newPageOptions).toHaveLength(1)
    expect(newPageOptions[0]?.blockResourceTypes).toEqual(
      expect.arrayContaining(['image', 'media', 'font', 'stylesheet']),
    )
  })
})
