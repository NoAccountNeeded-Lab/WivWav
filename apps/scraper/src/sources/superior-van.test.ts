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
  parseRampType,
  parseConversionManufacturer,
  parseCard,
  hashPage1Entries,
  isNavigationTimeout,
  SuperiorVanAdapter,
} from './superior-van.js'
import type { RawCard } from './superior-van.js'
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse } from '../browser/types.js'

// ─── parseMileage / parsePrice ───────────────────────────────────────────────

describe('parseMileage', () => {
  it('parses comma-formatted mileage', () => {
    expect(parseMileage('94,211')).toBe(94211)
  })

  it('returns null for empty input', () => {
    expect(parseMileage('')).toBeNull()
  })
})

describe('parsePrice', () => {
  it('converts a dollar amount to cents', () => {
    expect(parsePrice('$31,900')).toBe(3190000)
  })

  it('strips a "Web Special:" prefix before parsing', () => {
    expect(parsePrice('Web Special: $29,900'.replace(/^web special:?\s*/i, ''))).toBe(2990000)
  })

  it('returns null for empty input', () => {
    expect(parsePrice('')).toBeNull()
  })
})

// ─── parseConversionType / parseRampType ─────────────────────────────────────

describe('parseConversionType', () => {
  it('detects side and rear entry from a hyphenated slug turned into words', () => {
    expect(parseConversionType('side entry')).toBe('side_entry')
    expect(parseConversionType('rear entry')).toBe('rear_entry')
  })

  it('returns unknown for an empty slug', () => {
    expect(parseConversionType('')).toBe('unknown')
  })
})

describe('parseRampType', () => {
  it('maps power-in-floor to in_floor', () => {
    expect(parseRampType('power-in-floor')).toBe('in_floor')
  })

  it('maps power-fold-out and manual-fold-out to fold_out', () => {
    expect(parseRampType('power-fold-out')).toBe('fold_out')
    expect(parseRampType('manual-fold-out')).toBe('fold_out')
  })

  it('returns unknown for an empty slug', () => {
    expect(parseRampType('')).toBe('unknown')
  })
})

// ─── parseConversionManufacturer ─────────────────────────────────────────────

describe('parseConversionManufacturer', () => {
  it('normalizes the parenthetical "Vantage Mobility (VMI)" to VMI', () => {
    expect(parseConversionManufacturer('Vantage Mobility (VMI)')).toBe('VMI')
  })

  it('recognizes BraunAbility as-is', () => {
    expect(parseConversionManufacturer('BraunAbility')).toBe('BraunAbility')
  })

  it('returns null for brands not yet verified against the shared allowlist', () => {
    expect(parseConversionManufacturer('FR Conversions')).toBeNull()
    expect(parseConversionManufacturer('Adaptive Vans')).toBeNull()
    expect(parseConversionManufacturer('Additional Manufacturers')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseConversionManufacturer('')).toBeNull()
  })
})

// ─── parseCard ───────────────────────────────────────────────────────────────

const validCard: RawCard = {
  href: 'https://superiorvan.com/inventory/2010-vantage-mobility-vmi-chrysler-town-country-2a4rr4de0ar108839/',
  fullTitle: '2010 Vantage Mobility (VMI) Chrysler Town & Country LX',
  conditionLabel: 'Used',
  className:
    'elementor e-loop-item e-loop-item-180692 post-180692 inventory type-inventory status-publish hentry category-wheelchair-accessible-vehicles conversion-manufacturer-vantage-mobility-vmi make-chrysler ramp-location-side-entry ramp-type-power-in-floor vehicle-category-used vehicle-manufacturer-chrysler vehicle-type-consumer',
  fields: {
    'Conversion By': 'Vantage Mobility (VMI)',
    'Ramp Location': 'Side-Entry',
    'Stock': 'AR108839',
    'Trim': 'LX',
    'Mileage': '94,211',
  },
  priceText: '$31,900',
  webSpecialText: 'Web Special: $29,900',
  imageUrl: 'https://cdn.vehiclemall.com/photolibrary/original/vehicle/401/123357401/138529960.jpg',
}

describe('parseCard', () => {
  it('parses a complete valid card, preferring the Web Special price', () => {
    const result = parseCard(validCard)
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Chrysler')
    expect(result!.model).toBe('Town & Country')
    expect(result!.year).toBe(2010)
    expect(result!.trim).toBe('LX')
    expect(result!.vin).toBe('2A4RR4DE0AR108839')
    expect(result!.priceCents).toBe(2990000)
    expect(result!.mileage).toBe(94211)
    expect(result!.condition).toBe('used')
    expect(result!.wav.conversionType).toBe('side_entry')
    expect(result!.wav.rampType).toBe('in_floor')
    expect(result!.wav.conversionManufacturer).toBe('VMI')
    expect(result!.stockNumber).toBe('AR108839')
    expect(result!.dealer.name).toBe('Superior Van & Mobility')
    expect(result!.sourceId).toBe('superior-van')
    expect(result!.sourceUrl).toBe(validCard.href)
    expect(result!.sellerType).toBe('dealer')
  })

  it('falls back to the plain price when no Web Special is present', () => {
    const result = parseCard({ ...validCard, webSpecialText: '' })
    expect(result!.priceCents).toBe(3190000)
  })

  it('sets condition to "new" only when the badge text is exactly "New"', () => {
    expect(parseCard({ ...validCard, conditionLabel: 'New' })!.condition).toBe('new')
    expect(parseCard({ ...validCard, conditionLabel: 'Pre-Owned' })!.condition).toBe('used')
    expect(parseCard({ ...validCard, conditionLabel: '' })!.condition).toBe('used')
  })

  it('includes the vehicle photo when it passes the shared vehicle-image filter', () => {
    const result = parseCard(validCard)
    expect(result!.images).toHaveLength(1)
    expect(result!.images[0]).toBe(validCard.imageUrl)
  })

  it('excludes a "Coming Soon" placeholder graphic even though it is not caught by the shared filter', () => {
    const result = parseCard({
      ...validCard,
      imageUrl: 'https://superiorvan.com/wp-content/uploads/2026/03/Coming-Soon_FINALS-01.webp',
    })
    expect(result!.images).toEqual([])
  })

  it('excludes a non-vehicle image caught by the shared image-filter.ts patterns', () => {
    const result = parseCard({
      ...validCard,
      imageUrl: 'https://superiorvan.com/wp-content/uploads/2026/03/icon-100x100.png',
    })
    expect(result!.images).toEqual([])
  })

  it('returns null for a malformed card missing the detail href', () => {
    expect(parseCard({ ...validCard, href: '' })).toBeNull()
  })

  it('returns null for a malformed card missing the title', () => {
    expect(parseCard({ ...validCard, fullTitle: '' })).toBeNull()
  })

  it('returns null when the make class is absent (cannot locate model boundary)', () => {
    expect(parseCard({ ...validCard, className: 'elementor e-loop-item inventory' })).toBeNull()
  })

  it('returns null for implausible years', () => {
    expect(parseCard({ ...validCard, fullTitle: '1985 Vantage Mobility (VMI) Chrysler Town & Country LX' })).toBeNull()
    expect(parseCard({ ...validCard, fullTitle: '2099 Vantage Mobility (VMI) Chrysler Town & Country LX' })).toBeNull()
  })

  it('parses a second-hand-manufacturer title without an explicit Trim field', () => {
    const result = parseCard({
      ...validCard,
      href: 'https://superiorvan.com/inventory/2019-adaptive-vans-dodge-grand-caravan-2c4rdgbgxkr767507/',
      fullTitle: '2019 Adaptive Vans Dodge Grand Caravan SE',
      className: validCard.className.replace('make-chrysler', 'make-dodge').replace('ramp-location-side-entry', 'ramp-location-side-entry'),
      fields: { ...validCard.fields, Trim: 'SE', Stock: 'KR767507', 'Conversion By': 'Adaptive Vans' },
    })
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Dodge')
    expect(result!.model).toBe('Grand Caravan')
    expect(result!.trim).toBe('SE')
    expect(result!.wav.conversionManufacturer).toBeNull()
  })

  it('handles missing mileage and missing stock gracefully', () => {
    const result = parseCard({ ...validCard, fields: { ...validCard.fields, Mileage: '', Stock: '' } })
    expect(result).not.toBeNull()
    expect(result!.mileage).toBeNull()
    expect(result!.stockNumber).toBeNull()
    expect(result!.externalId).toBe(result!.vin)
  })

  it('stores VIN and invalid_check_digit code when the check digit fails', () => {
    const result = parseCard({
      ...validCard,
      href: 'https://superiorvan.com/inventory/2010-vantage-mobility-vmi-chrysler-town-country-2a4rr4de0ar108838/',
    })
    expect(result).not.toBeNull()
    expect(result!.vin).toBe('2A4RR4DE0AR108838')
    expect(result!.qualityIssueCodes).toContain('invalid_check_digit')
  })

  it('stores null VIN and unparseable_vin code when the slug has no 17-char VIN segment', () => {
    const result = parseCard({ ...validCard, href: 'https://superiorvan.com/inventory/some-short-slug/' })
    expect(result).not.toBeNull()
    expect(result!.vin).toBeNull()
    expect(result!.qualityIssueCodes).toContain('unparseable_vin')
  })
})

// ─── hashPage1Entries / isNavigationTimeout ─────────────────────────────────

describe('hashPage1Entries', () => {
  it('changes when entries change', () => {
    const before = hashPage1Entries(['url-a:$31,900'])
    const after = hashPage1Entries(['url-a:$29,900'])
    expect(after).not.toBe(before)
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

// ─── SuperiorVanAdapter.scrape — empty/no-listing pages ─────────────────────

describe('SuperiorVanAdapter.scrape empty page handling', () => {
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

    const adapter = new SuperiorVanAdapter(null, { browserService: makeEmptyService() })
    const result = await adapter.scrape()

    expect(result.listings).toEqual([])
    expect(result.fingerprintHash).toBeTruthy()
  })
})

// ─── SuperiorVanAdapter.checkPage1 timeout handling ─────────────────────────

describe('SuperiorVanAdapter.checkPage1 timeout handling', () => {
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

    const adapter = new SuperiorVanAdapter(null, { browserService: makeFailingService() })
    await expect(adapter.checkPage1()).rejects.toThrow('net::ERR_CONNECTION_REFUSED')
  })
})

// ─── SuperiorVanAdapter.checkStructure ───────────────────────────────────────

describe('SuperiorVanAdapter.checkStructure', () => {
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
                  return Promise.resolve({ signature: 'count:1|DIV[e-loop-item new-shape]', cardHtml: '<div class="e-loop-item new-shape"></div>' } as unknown as T)
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

    const staleHash = 'b'.repeat(64)
    const adapter = new SuperiorVanAdapter(staleHash, { browserService: makeStructureService() })
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

    const adapter = new SuperiorVanAdapter(null, { browserService: makeStructureService() })
    const result = await adapter.checkStructure()

    expect(result.changed).toBe(false)
    expect(result.previousHash).toBeNull()
  })
})

// ─── SuperiorVanAdapter.scrape resource blocking ────────────────────────────

describe('SuperiorVanAdapter.scrape resource blocking', () => {
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

    const adapter = new SuperiorVanAdapter(null, { browserService: makeRecordingService() })
    await adapter.scrape()

    expect(newPageOptions).toHaveLength(1)
    expect(newPageOptions[0]).toMatchObject({
      blockResourceTypes: expect.arrayContaining(['image', 'media', 'font', 'stylesheet']),
    })
  })
})
