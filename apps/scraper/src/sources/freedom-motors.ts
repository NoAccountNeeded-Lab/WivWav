import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/db'
import { isVehicleImageUrl } from './image-filter.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'

const SOURCE_ID = 'freedom-motors'
const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
const BASE_URL = 'https://www.freedommotors.com'
const LISTINGS_PATH = '/handicap-vehicles-for-sale/'
const NAVIGATION_TIMEOUT_MS = 30_000
const CARD_SEL = 'li.product'

// Robots.txt review (2026-07-03): https://www.freedommotors.com/robots.txt disallows
// only /wp-admin/ (admin-ajax.php is explicitly re-allowed). Neither the listing grid
// path (/handicap-vehicles-for-sale/) nor individual product pages (/product/…) are
// restricted, and no crawl-delay directive is set. This adapter still paginates one
// page at a time on a single reused Page (see scrape()) rather than fetching pages
// concurrently, matching the conservative pacing used by the other sources here.

// Freedom Motors is a single-location manufacturer/dealer (740 Watkins Rd, Battle
// Creek, MI 49015 — confirmed via /contact/), so dealer identity and location are
// constant for every listing rather than parsed per-card.
const DEALER_NAME = 'Freedom Motors'
const DEALER_PHONE = '(866) 577-0794'
const DEALER_LOCATION = { zip: '49015', city: 'Battle Creek', state: 'MI', lat: null, lng: null } as const

// Freedom Motors converts every vehicle in-house — there is no separate
// conversion-manufacturer field to parse from the page.
const CONVERSION_MANUFACTURER = 'Freedom Motors'

// New-vs-used heuristic: the listing grid has no explicit condition badge. Freedom
// Motors' business is converting current-model-year vehicles to order, and observed
// mileage clusters at single/double digits for freshly converted stock (e.g. 57, 32
// miles) versus four-to-five-digit odometer readings for trade-in/consignment
// vehicles (e.g. 51,693 miles on a 2020 Toyota Sienna). This threshold codifies that
// gap; it is a best-effort inference, not a value scraped verbatim from the page.
const NEW_MILEAGE_THRESHOLD_MILES = 1_000

interface FreedomMotorsConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  browserService?: BrowserService
  /** Override retry backoff for testing — defaults to INITIAL_NAV_BACKOFF_MS. */
  navRetryBackoffMs?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: FreedomMotorsConfig = {},
): SourceAdapter {
  return new FreedomMotorsAdapter(previousHash, config)
}

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  productLink: string   // e.g. "https://www.freedommotors.com/product/wheelchair-suv/2025-kia-telluride-ex-6/"
  itemName: string      // e.g. "2025 Kia Telluride EX" — from the gtm4wp product-data JSON
  sku: string           // VIN, from the gtm4wp product-data JSON
  price: number | null  // dollars (not cents), from the gtm4wp product-data JSON
  stockLevel: string    // internal stock/lot number, from the gtm4wp product-data JSON
  imageUrl: string
  conversionLocation: string // e.g. "Rear Entry Full-Cut", "Side Entry"
  mileage: string            // e.g. "57"
  transmission: string       // e.g. "8-Speed Automatic w/OD"
}

export class FreedomMotorsAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'Freedom Motors'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly browserService: BrowserService | null
  private readonly navRetryBackoffMs: number

  constructor(previousHash: string | null = null, config: FreedomMotorsConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.maxPages = config.maxPages ?? Infinity
    this.browserService = config.browserService ?? null
    this.navRetryBackoffMs = config.navRetryBackoffMs ?? INITIAL_NAV_BACKOFF_MS
  }

  private async getBrowserService(): Promise<BrowserService> {
    if (this.browserService) return this.browserService
    const { PlaywrightBrowserService } = await import('../browser/index.js')
    return new PlaywrightBrowserService()
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const service = await this.getBrowserService()
    const browser = await service.launch()
    try {
      const page = await browser.newPage()
      await withNavigationRetry(
        () => page.goto(`${BASE_URL}${LISTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }),
        INITIAL_NAV_MAX_ATTEMPTS,
        this.navRetryBackoffMs,
      )
      await page.waitForSelector(CARD_SEL, { timeout: 15_000 }).catch(() => {})

      // Hash "sku:price" per card so a price change triggers a full crawl even
      // when the set of listings on page 1 is unchanged.
      const entries = await page.evaluate(function (sel: string): string[] {
        const results: string[] = []
        document.querySelectorAll(sel).forEach(function (card) {
          const dataEl = card.querySelector('span.gtm4wp_productdata')
          const raw = dataEl?.getAttribute('data-gtm4wp_product_data') ?? ''
          if (!raw) return
          try {
            const data = JSON.parse(raw) as { sku?: string; price?: number }
            if (!data.sku) return
            results.push(`${data.sku}:${data.price ?? ''}`)
          } catch {
            // Malformed JSON on this card — skip it rather than fail the whole hash.
          }
        })
        return results
      }, CARD_SEL)

      const currentHash = hashPage1Entries(entries)
      const changed = this.previousPage1Hash === null || this.previousPage1Hash !== currentHash
      return { currentHash, changed }
    } finally {
      await browser.close()
    }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const service = await this.getBrowserService()
    const browser = await service.launch()
    try {
      const page = await browser.newPage()
      await withNavigationRetry(
        () => page.goto(`${BASE_URL}${LISTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }),
        INITIAL_NAV_MAX_ATTEMPTS,
        this.navRetryBackoffMs,
      )
      await page.waitForSelector(CARD_SEL, { timeout: 15_000 }).catch(() => {})

      const { signature, cardHtml } = await page.evaluate(function (sel: string): { signature: string; cardHtml: string } {
        const cards = document.querySelectorAll(sel)
        const first = cards[0]
        if (!first) return { signature: 'no-cards', cardHtml: '' }
        // Iterative DFS — tsx's esbuild injects __name() for named function declarations,
        // which is undefined in the Playwright browser sandbox where only the function body
        // is serialized, not the module-level helper.
        const parts: string[] = []
        const stack: Array<[Element, number]> = [[first, 0]]
        while (stack.length > 0) {
          const item = stack.pop()!
          const el = item[0]
          const depth = item[1]
          if (depth > 3) continue
          parts.push(`${el.tagName}[${el.className}]`)
          for (let i = el.children.length - 1; i >= 0; i--) {
            stack.push([el.children[i]!, depth + 1])
          }
        }
        return { signature: `count:${cards.length}|${parts.join(',')}`, cardHtml: first.outerHTML }
      }, CARD_SEL)

      const currentHash = createHash('sha256').update(signature).digest('hex')
      const changed = this.previousHash !== null && this.previousHash !== currentHash
      return {
        changed,
        currentHash,
        previousHash: this.previousHash,
        // Scoped to the listing card itself (not page.content()) so unrelated page-wide
        // markup doesn't crowd out the actual listing structure when the AI remap prompt
        // truncates the sample.
        ...(changed ? { sampleHtml: cardHtml } : {}),
      }
    } finally {
      await browser.close()
    }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const service = await this.getBrowserService()
    const browser = await service.launch()
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []

    try {
      // Block image/media/font/stylesheet bytes: this single page is reused
      // across every listing page, and loading those subresources accumulates
      // in-flight requests until Chromium fails navigation with
      // net::ERR_INSUFFICIENT_RESOURCES. Card image URLs are read from the
      // img src attribute, so the bytes are never needed.
      const page = await browser.newPage({
        blockResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      })
      let pageNum = 1
      await report(context, '[freedom-motors] Starting listing pagination', {
        stage: 'scraping',
        source: SOURCE_ID,
        page: pageNum,
        listings: 0,
      })

      while (pageNum <= this.maxPages) {
        const url = pageNum === 1 ? `${BASE_URL}${LISTINGS_PATH}` : `${BASE_URL}${LISTINGS_PATH}page/${pageNum}/`

        await report(context, `[freedom-motors] Loading listing page ${pageNum}: ${url}`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          listings: listings.length,
        })

        try {
          if (pageNum === 1) {
            await withNavigationRetry(
              () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }),
              INITIAL_NAV_MAX_ATTEMPTS,
              this.navRetryBackoffMs,
            )
          } else {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
          }
        } catch (err) {
          if (pageNum > 1 && isNavigationTimeout(err)) {
            await report(context, `[freedom-motors] Stopping pagination after timeout loading page ${pageNum}: ${url}`, {
              stage: 'scraping',
              source: SOURCE_ID,
              page: pageNum,
              listings: listings.length,
              reason: 'page_timeout',
            })
            break
          }
          throw err
        }
        await page.waitForSelector(CARD_SEL, { timeout: 15_000 }).catch(() => {})

        const cards = await page.evaluate(function (sel: string): RawCard[] {
          const results: RawCard[] = []

          document.querySelectorAll(sel).forEach(function (card) {
            const dataEl = card.querySelector('span.gtm4wp_productdata')
            const raw = dataEl?.getAttribute('data-gtm4wp_product_data') ?? ''
            let productLink = ''
            let itemName = ''
            let sku = ''
            let price: number | null = null
            let stockLevel = ''
            if (raw) {
              try {
                const data = JSON.parse(raw) as {
                  productlink?: string
                  item_name?: string
                  sku?: string
                  price?: number
                  stocklevel?: number | string
                }
                productLink = data.productlink ?? ''
                itemName = data.item_name ?? ''
                sku = data.sku ?? ''
                price = typeof data.price === 'number' ? data.price : null
                stockLevel = data.stocklevel !== undefined ? String(data.stocklevel) : ''
              } catch {
                // Malformed JSON — fields stay empty and parseCard will reject the card.
              }
            }

            const imgEl = card.querySelector('.image_container img') as HTMLImageElement | null
            const imageUrl = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? ''

            // Attribute list: <li class="attribute"><span>Label:</span> <b>Value</b></li>
            const fields: Record<string, string> = {}
            card.querySelectorAll('ul.product-attributes li.attribute').forEach(function (li) {
              const label = li.querySelector('span')?.textContent?.trim().replace(/:$/, '') ?? ''
              const value = li.querySelector('b')?.textContent?.trim() ?? ''
              if (label) fields[label] = value
            })

            results.push({
              productLink,
              itemName,
              sku,
              price,
              stockLevel,
              imageUrl,
              conversionLocation: fields['Conversion Location'] ?? '',
              mileage: fields['Mileage'] ?? '',
              transmission: fields['Trans'] ?? '',
            })
          })

          return results
        }, CARD_SEL)

        await report(context, `[freedom-motors] Page ${pageNum} returned ${cards.length} card(s)`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          cards: cards.length,
          listings: listings.length,
        })

        if (cards.length === 0) {
          await report(context, `[freedom-motors] No cards found on page ${pageNum}; stopping pagination`, {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            listings: listings.length,
            reason: 'no_cards',
          })
          break
        }

        let parsedOnPage = 0
        for (const card of cards) {
          const listing = parseCard(card)
          if (listing) {
            listings.push(listing)
            parsedOnPage++
          }
        }

        await report(context, `[freedom-motors] Parsed ${parsedOnPage}/${cards.length} card(s) on page ${pageNum}; ${listings.length} listing(s) total`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          cards: cards.length,
          parsed: parsedOnPage,
          listings: listings.length,
        })

        // Belt-and-suspenders alongside the cards.length===0 check above: if a
        // future WooCommerce/WordPress redesign clamps out-of-range pagination to
        // the last page instead of rendering an empty grid, cards.length would
        // never reach 0 and this loop would otherwise run until maxPages (Infinity
        // in production). WooCommerce's default pagination renders a real
        // next-page link only while a next page exists.
        const hasNext = await page.evaluate(function (): boolean {
          return document.querySelector('a.next.page-numbers') !== null
        })

        if (!hasNext) {
          await report(context, `[freedom-motors] No next-page link after page ${pageNum}; pagination complete`, {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            listings: listings.length,
          })
          break
        }

        pageNum++
      }

      const fingerprintHash = createHash('sha256')
        .update(listings.map(l => l.vin ?? l.sourceUrl).join('|'))
        .digest('hex')

      return { listings, fingerprintHash }
    } finally {
      await browser.close()
    }
  }
}

export function hashPage1Entries(entries: string[]): string {
  return createHash('sha256').update(entries.sort().join(',') || 'empty').digest('hex')
}

export { isNavigationTimeout } from '../util/navigation-timeout.js'

export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  if (!raw.productLink || !raw.itemName) return null

  // "2025 Kia Telluride EX" → year, make, model, trim
  const { year, make, model, trim } = parseVehicleTitle(raw.itemName)

  if (!make || !model || Number.isNaN(year) || year < 1990 || year > new Date().getFullYear() + 2) return null

  const normalizedVin = normalizeVin(raw.sku)
  const qualityIssueCodes: string[] = []

  let vin: string | null
  if (!raw.sku || !isValidVin(normalizedVin)) {
    vin = null
    if (raw.sku) qualityIssueCodes.push('unparseable_vin')
  } else if (!checkDigitValid(normalizedVin)) {
    vin = normalizedVin
    qualityIssueCodes.push('invalid_check_digit')
  } else {
    vin = normalizedVin
  }

  const mileage = parseMileage(raw.mileage)
  const priceCents = raw.price !== null ? Math.round(raw.price * 100) : null
  const condition: ListingCondition = mileage !== null && mileage < NEW_MILEAGE_THRESHOLD_MILES ? 'new' : 'used'
  const conversionType = parseConversionType(raw.conversionLocation)

  const sourceUrl = raw.productLink
  const stockNumber = raw.stockLevel || null
  const externalId = stockNumber || vin || null

  return {
    sourceId: SOURCE_ID,
    sourceUrl,
    buyerUrl: sourceUrl,
    externalId,
    stockNumber,
    sourceRecordKey: externalId ?? normalizeSourceUrl(sourceUrl),
    make,
    model,
    year,
    trim,
    vin,
    condition,
    sellerType: 'dealer',
    priceCents,
    mileage,
    color: null,
    fuelType: null,
    transmission: raw.transmission || null,
    wav: {
      conversionType,
      conversionManufacturer: CONVERSION_MANUFACTURER,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { ...DEALER_LOCATION },
    dealer: { name: DEALER_NAME, phone: DEALER_PHONE, website: BASE_URL },
    images: raw.imageUrl && isVehicleImageUrl(raw.imageUrl) ? [raw.imageUrl] : [],
    description: null,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
  }
}

/** Strip query string and trailing slash for a stable URL-based record key. */
export function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

export function parseMileage(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1]!, 10) : null
}

export function parseConversionType(text: string): ConversionType {
  const t = text.toLowerCase()
  if (t.includes('rear entry') || t.includes('rear-entry')) return 'rear_entry'
  if (t.includes('side entry') || t.includes('side-entry')) return 'side_entry'
  return 'unknown'
}
