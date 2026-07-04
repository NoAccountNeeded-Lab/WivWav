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
  parseConversionType,
  parseCard,
  hashPage1Entries,
  isNavigationTimeout,
  FreedomMotorsAdapter,
} from './freedom-motors.js'
import type { RawCard } from './freedom-motors.js'
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse } from '../browser/types.js'

// ─── parseMileage ────────────────────────────────────────────────────────────

describe('parseMileage', () => {
  it('parses comma-formatted mileage', () => {
    expect(parseMileage('51,693')).toBe(51693)
  })

  it('parses mileage without commas', () => {
    expect(parseMileage('57')).toBe(57)
  })

  it('returns null for empty or non-numeric input', () => {
    expect(parseMileage('')).toBeNull()
    expect(parseMileage('N/A')).toBeNull()
  })
})

// ─── parseConversionType ─────────────────────────────────────────────────────

describe('parseConversionType', () => {
  it('detects rear entry variants', () => {
    expect(parseConversionType('Rear Entry Full-Cut')).toBe('rear_entry')
    expect(parseConversionType('Rear Entry Deep Floor (650lb Weight Limit)')).toBe('rear_entry')
  })

  it('detects side entry', () => {
    expect(parseConversionType('Side Entry')).toBe('side_entry')
  })

  it('returns unknown when entry type is not mentioned', () => {
    expect(parseConversionType('')).toBe('unknown')
    expect(parseConversionType('Automatic')).toBe('unknown')
  })
})

// ─── parseCard ───────────────────────────────────────────────────────────────

const validCard: RawCard = {
  productLink: 'https://www.freedommotors.com/product/wheelchair-suv/2025-kia-telluride-ex-6/',
  itemName: '2025 Kia Telluride EX',
  sku: '5XYP34GC6SG653796',
  price: 85337,
  stockLevel: '32111',
  imageUrl: 'https://www.freedommotors.com/wp-content/uploads/2025/10/0e3830c89d7f42dfa688e588a2d5acf6-300x225.jpg',
  conversionLocation: 'Rear Entry Full-Cut',
  mileage: '57',
  transmission: '8-Speed Automatic w/OD',
}

describe('parseCard', () => {
  it('parses a complete valid card', () => {
    const result = parseCard(validCard)
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Kia')
    expect(result!.model).toBe('Telluride')
    expect(result!.year).toBe(2025)
    expect(result!.trim).toBe('EX')
    expect(result!.vin).toBe('5XYP34GC6SG653796')
    expect(result!.priceCents).toBe(8533700)
    expect(result!.mileage).toBe(57)
    expect(result!.transmission).toBe('8-Speed Automatic w/OD')
    expect(result!.wav.conversionType).toBe('rear_entry')
    expect(result!.wav.conversionManufacturer).toBe('Freedom Motors')
    expect(result!.dealer.name).toBe('Freedom Motors')
    expect(result!.location.city).toBe('Battle Creek')
    expect(result!.location.state).toBe('MI')
    expect(result!.sourceId).toBe('freedom-motors')
    expect(result!.sourceUrl).toBe(validCard.productLink)
    expect(result!.buyerUrl).toBe(result!.sourceUrl)
    expect(result!.sellerType).toBe('dealer')
    expect(result!.stockNumber).toBe('32111')
    expect(result!.externalId).toBe('32111')
    expect(result!.sourceRecordKey).toBe('32111')
  })

  it('classifies low-mileage vehicles as new and higher-mileage vehicles as used', () => {
    const newResult = parseCard({ ...validCard, mileage: '32' })
    expect(newResult!.condition).toBe('new')

    const usedResult = parseCard({ ...validCard, itemName: '2020 Toyota Sienna L', mileage: '51,693' })
    expect(usedResult!.condition).toBe('used')
  })

  it('includes the thumbnail image when it passes the shared vehicle-image filter', () => {
    const result = parseCard(validCard)
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0]).toBe(validCard.imageUrl)
  })

  it('excludes a non-vehicle image (e.g. a WooCommerce placeholder) using image-filter.ts', () => {
    const result = parseCard({
      ...validCard,
      imageUrl: 'https://www.freedommotors.com/wp-content/plugins/woocommerce/assets/images/placeholder.png',
    })
    expect(result!.images).toEqual([])
  })

  it('returns null for a malformed card missing the product link', () => {
    expect(parseCard({ ...validCard, productLink: '' })).toBeNull()
  })

  it('returns null for a malformed card missing the item name', () => {
    expect(parseCard({ ...validCard, itemName: '' })).toBeNull()
  })

  it('returns null when make or model cannot be parsed', () => {
    expect(parseCard({ ...validCard, itemName: '2025' })).toBeNull()
  })

  it('returns null for implausible years', () => {
    expect(parseCard({ ...validCard, itemName: '1985 Kia Telluride EX' })).toBeNull()
    expect(parseCard({ ...validCard, itemName: '2099 Kia Telluride EX' })).toBeNull()
  })

  it('handles a missing price gracefully', () => {
    const result = parseCard({ ...validCard, price: null })
    expect(result).not.toBeNull()
    expect(result!.priceCents).toBeNull()
  })

  it('handles missing mileage gracefully (defaults to used, the conservative condition)', () => {
    const result = parseCard({ ...validCard, mileage: '' })
    expect(result).not.toBeNull()
    expect(result!.mileage).toBeNull()
    expect(result!.condition).toBe('used')
  })

  it('stores null VIN without a quality code when the sku is absent (nothing malformed to flag)', () => {
    const result = parseCard({ ...validCard, sku: '' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toBeUndefined()
  })

  it('stores null VIN and unparseable_vin code when the sku is present but garbage', () => {
    const result = parseCard({ ...validCard, sku: 'TOOSHORT' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })

  it('stores VIN and invalid_check_digit code when the check digit fails', () => {
    // Valid structure but wrong check digit (swap last char)
    const result = parseCard({ ...validCard, sku: '5XYP34GC6SG653797' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBe('5XYP34GC6SG653797')
    expect(result!.qualityIssueCodes).toContain('invalid_check_digit')
  })

  it('falls back to normalized sourceUrl for sourceRecordKey when stock is absent', () => {
    const result = parseCard({ ...validCard, stockLevel: '' })
    expect(result!.externalId).toBe(result!.vin)
    expect(result!.sourceRecordKey).toBe(result!.vin)
  })
})

// ─── hashPage1Entries / isNavigationTimeout ─────────────────────────────────

describe('hashPage1Entries', () => {
  it('changes when entries change', () => {
    const before = hashPage1Entries(['5XYP34GC6SG653796:85337'])
    const after = hashPage1Entries(['5XYP34GC6SG653796:83052'])
    expect(after).not.toBe(before)
  })

  it('is order-independent', () => {
    const a = hashPage1Entries(['a:1', 'b:2'])
    const b = hashPage1Entries(['b:2', 'a:1'])
    expect(a).toBe(b)
  })
})

describe('isNavigationTimeout', () => {
  it('detects Playwright navigation timeout errors', () => {
    expect(isNavigationTimeout(new Error('page.goto: Timeout 30000ms exceeded.'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isNavigationTimeout(new Error('net::ERR_ABORTED'))).toBe(false)
  })
})

// ─── FreedomMotorsAdapter.scrape — empty/no-listing pages ───────────────────

describe('FreedomMotorsAdapter.scrape empty page handling', () => {
  it('returns an empty listing array without throwing when the grid has no cards', async () => {
    function makeEmptyService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(): Promise<BrowserResponse | null> { return { status: () => 200 } },
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

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeEmptyService() })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(result.fingerprintHash).toBeTruthy()
  })
})

// ─── FreedomMotorsAdapter.checkPage1 timeout handling ───────────────────────

describe('FreedomMotorsAdapter.checkPage1 timeout handling', () => {
  it('rethrows non-timeout errors from goto', async () => {
    function makeFailingService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(): Promise<BrowserResponse | null> {
                  throw new Error('net::ERR_CONNECTION_REFUSED')
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
    }

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeFailingService() })
    await expect(adapter.checkPage1()).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })
})

// ─── FreedomMotorsAdapter.checkStructure ─────────────────────────────────────

describe('FreedomMotorsAdapter.checkStructure', () => {
  it('marks the source as changed and returns sample HTML when the DOM signature differs', async () => {
    function makeStructureService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(): Promise<BrowserResponse | null> { return { status: () => 200 } },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '' },
                url(): string { return '' },
                evaluate<T>(): Promise<T> {
                  return Promise.resolve({ signature: 'count:1|LI[product new-shape]', cardHtml: '<li class="product new-shape"></li>' } as unknown as T)
                },
                async waitForSelector(): Promise<void> {},
                async close(): Promise<void> {},
              }
            },
            async close(): Promise<void> {},
          }
        },
      }
    }

    const staleHash = 'a'.repeat(64)
    const adapter = new FreedomMotorsAdapter(staleHash, { browserService: makeStructureService() })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(true)
    expect(result.sampleHtml).toContain('new-shape')
    expect(result.currentHash).not.toBe(staleHash)
  })

  it('reports unchanged when no previous hash exists yet (first run)', async () => {
    function makeStructureService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(): Promise<BrowserResponse | null> { return { status: () => 200 } },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '' },
                url(): string { return '' },
                evaluate<T>(): Promise<T> {
                  return Promise.resolve({ signature: 'no-cards', cardHtml: '' } as unknown as T)
                },
                async waitForSelector(): Promise<void> {},
                async close(): Promise<void> {},
              }
            },
            async close(): Promise<void> {},
          }
        },
      }
    }

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeStructureService() })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(false)
    expect(result.previousHash).toBeNull()
  })
})

// ─── FreedomMotorsAdapter.scrape resource blocking ──────────────────────────

describe('FreedomMotorsAdapter.scrape resource blocking', () => {
  it('opens its page with image/media/font/stylesheet blocking', async () => {
    const newPageOptions: unknown[] = []

    function makeRecordingService(): BrowserService {
      return {
        async launch() {
          return {
            async newPage(options?: unknown) {
              newPageOptions.push(options)
              return {
                async goto(): Promise<BrowserResponse | null> { return { status: () => 200 } },
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

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeRecordingService() })
    await adapter.scrape()

    expect(newPageOptions).toHaveLength(1)
    expect(newPageOptions[0]).toMatchObject({
      blockResourceTypes: expect.arrayContaining(['image', 'media', 'font', 'stylesheet']),
    })
  })
})
