import { describe, it, expect, vi } from 'vitest'


import {
  parseMileage,
  parseConversionType,
  parseCard,
  hashPage1Entries,
  isNavigationTimeout,
  FreedomMotorsAdapter,
  readStructureSignature,
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

  // ─── Multi-word model titles (refs #618) ────────────────────────────────────
  // The tokenizer used to assume `model` was always exactly one token, which
  // truncated multi-word models and dumped the rest into `trim`.

  it('parses "Town & Country" as the full model, not just "Town"', () => {
    const result = parseCard({ ...validCard, itemName: '2024 Chrysler Town & Country Touring' })
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Chrysler')
    expect(result!.model).toBe('Town & Country')
    expect(result!.trim).toBe('Touring')
  })

  it('parses "Grand Caravan" as the full model, not just "Grand"', () => {
    const result = parseCard({ ...validCard, itemName: '2019 Dodge Grand Caravan SXT' })
    expect(result).not.toBeNull()
    expect(result!.make).toBe('Dodge')
    expect(result!.model).toBe('Grand Caravan')
    expect(result!.trim).toBe('SXT')
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

// ─── FreedomMotorsAdapter.scrape multi-page traversal ───────────────────────

describe('FreedomMotorsAdapter.scrape multi-page traversal', () => {
  it('advances to page 2 via the next-page link and stops once page 2 has no cards', async () => {
    const gotoUrls: string[] = []
    // evaluate() is called twice per page that has cards (card extraction, then
    // the next-page-link check) and once for a page with no cards (extraction
    // only — the loop breaks before checking for a next link).
    const evaluateReturns: unknown[] = [
      [{ ...validCard }], // page 1: one card
      true,               // page 1: a.next.page-numbers found
      [],                 // page 2: no cards
    ]

    function makeTwoPageService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(url: string): Promise<BrowserResponse | null> {
                  gotoUrls.push(url)
                  return { status: () => 200 }
                },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '<html></html>' },
                url(): string { return '' },
                evaluate<T>(): Promise<T> { return Promise.resolve(evaluateReturns.shift() as T) },
                async waitForSelector(): Promise<void> {},
                async close(): Promise<void> {},
              }
            },
            async close(): Promise<void> {},
          }
        },
      }
    }

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeTwoPageService() })
    const result = await adapter.scrape()

    expect(gotoUrls).toEqual([
      'https://www.freedommotors.com/handicap-vehicles-for-sale/',
      'https://www.freedommotors.com/handicap-vehicles-for-sale/page/2/',
    ])
    expect(result.listings).toHaveLength(1)
    expect(result.listings[0]!.vin).toBe(validCard.sku)
  })

  it('stops after page 1 when no next-page link is present, even though page 1 had cards', async () => {
    const evaluateReturns: unknown[] = [
      [{ ...validCard }], // page 1: one card
      false,              // page 1: no next-page link
    ]
    const gotoUrls: string[] = []

    function makeOnePageService(): BrowserService {
      return {
        async launch(): Promise<BrowserSession> {
          return {
            async newPage(): Promise<BrowserPage> {
              return {
                async goto(url: string): Promise<BrowserResponse | null> {
                  gotoUrls.push(url)
                  return { status: () => 200 }
                },
                async setContent(): Promise<void> {},
                async content(): Promise<string> { return '<html></html>' },
                url(): string { return '' },
                evaluate<T>(): Promise<T> { return Promise.resolve(evaluateReturns.shift() as T) },
                async waitForSelector(): Promise<void> {},
                async close(): Promise<void> {},
              }
            },
            async close(): Promise<void> {},
          }
        },
      }
    }

    const adapter = new FreedomMotorsAdapter(null, { browserService: makeOnePageService() })
    const result = await adapter.scrape()

    // Only page 1 was ever requested — the missing next-page link stopped
    // pagination before a page 2 request was made.
    expect(gotoUrls).toEqual(['https://www.freedommotors.com/handicap-vehicles-for-sale/'])
    expect(result.listings).toHaveLength(1)
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

// ─── readStructureSignature (in-page fingerprint, #1096) ─────────────────────

interface FakeEl { tagName: string; className: string; children: FakeEl[]; outerHTML: string }

function el(tagName: string, className: string, children: FakeEl[] = []): FakeEl {
  return { tagName, className, children, outerHTML: `<${tagName.toLowerCase()} class="${className}">` }
}

/** One WooCommerce-style card. `postId`/`onSale`/`stock` are per-listing state. */
function card(opts: { postId: number; onSale?: boolean; stock?: string; imageClass?: string; withAttributes?: boolean }): FakeEl {
  const { postId, onSale = false, stock = 'instock', imageClass = 'image_container', withAttributes = true } = opts
  const imageChildren = [...(onSale ? [el('SPAN', 'onsale')] : []), el('IMG', 'attachment-woocommerce_thumbnail')]
  const details = [
    el('A', '', [el('H2', 'woocommerce-loop-product__title')]),
    ...(withAttributes ? [el('DIV', 'product_attributes', [el('UL', 'product-attributes', [el('LI', 'attribute', [el('SPAN', ''), el('B', '')])])])] : []),
  ]
  return el('LI', `product type-product post-${postId} status-publish ${stock} product_cat-sport-utility ${onSale ? 'sale' : ''} has-post-thumbnail`, [
    el('DIV', 'image_title_details_container', [el('A', imageClass, imageChildren), el('DIV', 'title_details_container w-100', details)]),
  ])
}

function signatureFor(cards: FakeEl[]): string {
  vi.stubGlobal('document', { querySelectorAll: () => cards })
  try {
    return readStructureSignature('li.product').signature
  } finally {
    vi.unstubAllGlobals()
  }
}

describe('readStructureSignature', () => {
  it('is identical when only per-listing state, card order, or card count differ', () => {
    const page1 = [card({ postId: 67893, onSale: true }), card({ postId: 68479 }), card({ postId: 70001, stock: 'outofstock' })]
    const page2 = [card({ postId: 73529 }), card({ postId: 73530, onSale: true })]
    expect(signatureFor(page1)).toBe(signatureFor(page2))
    expect(signatureFor(page1)).toBe(signatureFor([...page1].reverse()))
    expect(signatureFor(page1)).toBe(signatureFor([card({ postId: 1 })]))
  })

  it('changes when a layout element the scraper depends on is renamed or removed', () => {
    const baseline = signatureFor([card({ postId: 1 })])
    expect(signatureFor([card({ postId: 1, imageClass: 'image_wrapper' })])).not.toBe(baseline)
    expect(signatureFor([card({ postId: 1, withAttributes: false })])).not.toBe(baseline)
  })

  it('reports no-cards when the grid is empty, with an empty sample', () => {
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    try {
      expect(readStructureSignature('li.product')).toEqual({ signature: 'no-cards', cardHtml: '' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns the first card html as the remap sample', () => {
    vi.stubGlobal('document', { querySelectorAll: () => [card({ postId: 5 }), card({ postId: 6 })] })
    try {
      expect(readStructureSignature('li.product').cardHtml).toContain('post-5')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
