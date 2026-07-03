import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { RobotsCache } from '../util/robots-cache.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/db'

const SOURCE_ID = 'blvd'
const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
const BASE_URL = 'https://www.blvd.com'
const LISTINGS_PATH = '/wheelchair-vans-for-sale'
const FSBO_LISTINGS_PATH = '/wheelchair-vans-for-sale-by-owner'
const LISTING_PATHS = [LISTINGS_PATH, FSBO_LISTINGS_PATH] as const
const CARD_SEL = 'div.track_vehicle'
const NAVIGATION_TIMEOUT_MS = 30_000

interface BlvdConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  browserService?: BrowserService
  /** Inject a RobotsCache instance for testing. Defaults to a new RobotsCache(). */
  robotsCache?: RobotsCache
  /** Override retry backoff for testing — defaults to INITIAL_NAV_BACKOFF_MS. */
  navRetryBackoffMs?: number
}

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  href: string
  fullTitle: string   // "2024 Toyota Sienna FWD XLE" from desktop h3
  conversion: string  // "Driverge Flex Maxx Wheelchair Van Conversion"
  condition: string   // "Used" | "New" from Vehicle Condition indicator, or "" when absent
  miles: string       // "50,094"
  price: string       // "$71,991" | "Call" | ""
  seller: string      // "MobilityWorks"
  location: string    // "North Las Vegas, NV"
  imageUrl: string
  dataId: string
}

export class BlvdAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'BLVD.com'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly browserService: BrowserService | null
  private readonly robotsCache: RobotsCache
  private readonly navRetryBackoffMs: number

  constructor(previousHash: string | null = null, config: BlvdConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.maxPages = config.maxPages ?? Infinity
    this.browserService = config.browserService ?? null
    this.robotsCache = config.robotsCache ?? new RobotsCache()
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

      const entries: string[] = []
      for (const listingPath of LISTING_PATHS) {
        try {
          await page.goto(getPage1CheckUrl(listingPath), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } catch (err) {
          if (isNavigationTimeout(err)) continue
          throw err
        }

        // Hash "id:price" per card so a price change triggers a full crawl even when
        // the set of listings on page 1 is unchanged.
        const pathEntries = await page.evaluate(function (sel: string): string[] {
          return Array.from(document.querySelectorAll(sel)).map(function (card) {
            const id = card.getAttribute('data-id') ?? ''
            if (!id) return ''
            let price = ''
            card.querySelectorAll('div.vlistp').forEach(function (label) {
              const h4 = label.nextElementSibling
              if (label.textContent?.trim() === 'Price' && h4?.tagName === 'H4') {
                price = h4.textContent?.trim() ?? ''
              }
            })
            return `${id}:${price}`
          }).filter(function (s) { return s.length > 0 })
        }, CARD_SEL)

        entries.push(...pathEntries.map(entry => `${listingPath}:${entry}`))
      }

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
        () => page.goto(`${BASE_URL}${LISTINGS_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
        INITIAL_NAV_MAX_ATTEMPTS,
        this.navRetryBackoffMs,
      )

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
        // markup — e.g. cookie-consent widgets — doesn't crowd out the actual listing
        // structure when the AI remap prompt truncates the sample.
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
    const robots = this.robotsCache

    try {
      // Block image/media/font/stylesheet bytes: this single page is reused
      // across every listing page, and loading those subresources accumulates
      // in-flight requests until Chromium fails navigation with
      // net::ERR_INSUFFICIENT_RESOURCES (historically around page 8). Card image
      // URLs are read from the img src attribute, so the bytes are never needed.
      const page = await browser.newPage({
        blockResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      })
      await report(context, '[blvd] Starting listing pagination', {
        stage: 'scraping',
        source: SOURCE_ID,
        page: 1,
        listings: 0,
      })

      for (const listingPath of LISTING_PATHS) {
        // Check robots.txt before scraping each path; skip and log when disallowed.
        const pathUrl = `${BASE_URL}${listingPath}`
        const allowed = await robots.isAllowed(pathUrl, 'WivWav/1.0')
        if (!allowed) {
          await report(context, `[blvd] robots.txt disallows ${pathUrl} — skipping path`, {
            stage: 'scraping',
            source: SOURCE_ID,
            reason: 'robots_disallowed',
          })
          continue
        }

        let pageNum = 1

        while (pageNum <= this.maxPages) {
          const url = getListingPageUrl(listingPath, pageNum)

          await report(context, `[blvd] Loading listing page ${pageNum}: ${url}`, {
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
              await report(context, `[blvd] Stopping pagination after timeout loading page ${pageNum}: ${url}`, {
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

          const cards = await page.evaluate(
            function ({ sel, baseUrl }: { sel: string; baseUrl: string }): RawCard[] {
              const results: RawCard[] = []

              document.querySelectorAll(sel).forEach(function (card) {
                // VIN and source URL from the "Details" link
                const detailLink = card.querySelector('a.more-van-details-btn') as HTMLAnchorElement | null
                const href = detailLink?.getAttribute('href') ?? ''

                // The desktop h3 has the full "2024 Toyota Sienna FWD XLE".
                // Find the h3 whose text starts with a 4-digit year.
                const h3s = Array.from(card.querySelectorAll('h3'))
                const fullTitleH3 = h3s.find(function (h) {
                  return /^\d{4}\s/.test(h.textContent?.trim() ?? '')
                })
                const fullTitle = fullTitleH3?.textContent?.trim() ?? ''

                const conversion = card.querySelector('h4.conversion')?.textContent?.trim() ?? ''

                // Vehicle condition badge — first newusedicon with data-title="Vehicle Condition".
                // Return '' when the element is absent so parseCard can skip ambiguous cards
                // rather than fabricating a 'new' condition.
                const condEl = card.querySelector(
                  '.newusedicon[data-title="Vehicle Condition"]',
                ) as HTMLElement | null
                const condition = condEl === null ? '' : condEl.classList.contains('Used') ? 'Used' : 'New'

                // vlistp label→value pairs (Miles / Price / Seller / Loc.)
                const fields: Record<string, string> = {}
                card.querySelectorAll('div.vlistp').forEach(function (label) {
                  const h4 = label.nextElementSibling
                  if (h4?.tagName === 'H4') {
                    fields[label.textContent?.trim() ?? ''] = h4.textContent?.trim() ?? ''
                  }
                })

                const imgEl = card.querySelector('img.img-responsive') as HTMLImageElement | null
                const imgSrc = imgEl?.getAttribute('src') ?? ''
                const imageUrl = imgSrc.startsWith('http') ? imgSrc : `${baseUrl}${imgSrc}`

                results.push({
                  href,
                  fullTitle,
                  conversion,
                  condition,
                  miles: fields['Miles'] ?? '',
                  price: fields['Price'] ?? '',
                  seller: fields['Seller'] ?? '',
                  location: fields['Loc.'] ?? '',
                  imageUrl,
                  dataId: card.getAttribute('data-id') ?? '',
                })
              })

              return results
            },
            { sel: CARD_SEL, baseUrl: BASE_URL },
          )

          await report(context, `[blvd] Page ${pageNum} returned ${cards.length} card(s)`, {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            cards: cards.length,
            listings: listings.length,
          })

          if (cards.length === 0) {
            await report(context, `[blvd] No cards found on page ${pageNum}; stopping pagination`, {
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

          await report(context, `[blvd] Parsed ${parsedOnPage}/${cards.length} card(s) on page ${pageNum}; ${listings.length} listing(s) total`, {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            cards: cards.length,
            parsed: parsedOnPage,
            listings: listings.length,
          })

          const hasNext = await page.evaluate(
            function () {
              return Array.from(document.querySelectorAll('a')).some(function (a) {
                return a.textContent?.trim() === 'Next'
              })
            },
          )

          if (!hasNext) {
            await report(context, `[blvd] No next page after page ${pageNum}; pagination complete`, {
              stage: 'scraping',
              source: SOURCE_ID,
              page: pageNum,
              listings: listings.length,
            })
            break
          }
          pageNum++
        }
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

function getPage1CheckUrl(path: string): string {
  // BLVD's public listing page does not expose a working newest-sort query parameter.
  return `${BASE_URL}${path}`
}

function getListingPageUrl(path: string, pageNum: number): string {
  return pageNum === 1 ? `${BASE_URL}${path}` : `${BASE_URL}${path}?page=${pageNum}`
}

export function hashPage1Entries(entries: string[]): string {
  return createHash('sha256').update(entries.sort().join(',') || 'empty').digest('hex')
}

export { isNavigationTimeout } from '../util/navigation-timeout.js'

export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  // Condition must be determinable — skip cards where the selector was absent to
  // avoid fabricating a 'new' value for vehicles that are actually used.
  if (raw.condition === '') return null

  // "2024 Toyota Sienna FWD XLE" → year, make, model, trim
  const parts = raw.fullTitle.trim().split(/\s+/)
  const year = parseInt(parts[0] ?? '0', 10)
  const make = parts[1] ?? ''
  const model = parts[2] ?? ''
  const trim = parts.slice(3).join(' ') || null

  if (!make || !model || year < 1990 || year > new Date().getFullYear() + 2) return null

  // Require a valid href — without it there is no source URL to use as a record key.
  if (!raw.href) return null

  // VIN: last path segment from the detail link.
  // Normalize: uppercase + strip non-alphanumeric display characters (e.g. hyphens).
  // Classify the result and record quality codes for downstream quarantine.
  const rawVinSegment = raw.href.split('/').pop() ?? ''
  const normalizedVin = normalizeVin(rawVinSegment)
  const qualityIssueCodes: string[] = []

  let vin: string | null
  if (!isValidVin(normalizedVin)) {
    // Wrong length or forbidden characters (I/O/Q) — not a plausible VIN.
    // Store null rather than a garbage string; mark for quarantine review.
    vin = null
    qualityIssueCodes.push('unparseable_vin')
  } else if (!checkDigitValid(normalizedVin)) {
    // Structural check passed but North American check-digit fails.
    // Retain the VIN (non-NA VINs may legitimately fail) but flag for review.
    // Rule id matches listing-validator.ts's invalid_check_digit rule, which
    // re-checks the same condition during publication — keeping the id in sync
    // means a source-level pre-check and the canonical validator never disagree
    // on what to call the same failure.
    vin = normalizedVin
    qualityIssueCodes.push('invalid_check_digit')
  } else {
    vin = normalizedVin
  }

  const mileage = parseMileage(raw.miles)
  const priceCents = parsePrice(raw.price)

  const locationParts = raw.location.split(',').map(s => s.trim())
  const city = locationParts[0] || null
  const state = locationParts[1] || null

  const condition: ListingCondition = raw.condition === 'New' ? 'new' : 'used'
  const conversionType = parseConversionType(raw.conversion)
  const conversionManufacturer = parseConversionManufacturer(raw.conversion)

  const sourceUrl = raw.href.startsWith('http') ? raw.href : `${BASE_URL}${raw.href}`
  const isPrivateSeller = /^for sale by owner$/i.test(raw.seller.trim())
  const externalId = raw.dataId || null

  return {
    sourceId: SOURCE_ID,
    sourceUrl,
    buyerUrl: sourceUrl,
    externalId,
    stockNumber: null,
    sourceRecordKey: externalId ?? normalizeSourceUrl(sourceUrl),
    make,
    model,
    year,
    trim,
    vin,
    condition,
    sellerType: isPrivateSeller ? 'private' : 'dealer',
    priceCents,
    mileage,
    color: null,
    fuelType: null,
    transmission: null,
    wav: {
      conversionType,
      conversionManufacturer,
      floorLoweringInches: null,
      rampType: 'unknown',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city, state, lat: null, lng: null },
    dealer: { name: raw.seller || null, phone: null, website: null },
    images: raw.imageUrl ? [raw.imageUrl] : [],
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

export function parsePrice(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+)/)
  return m ? parseInt(m[1]!, 10) * 100 : null
}

export function parseConversionType(text: string): ConversionType {
  const t = text.toLowerCase()
  if (t.includes('rear entry') || t.includes('rear-entry')) return 'rear_entry'
  if (t.includes('side entry') || t.includes('side-entry')) return 'side_entry'
  return 'unknown'
}

// BLVD's `conversion` card field mixes two unrelated kinds of text: entry-style
// descriptions ("Side Entry", "Rear Entry Manual Fold Out") and, on some cards,
// a manufacturer-led product name ("Driverge Flex Maxx Wheelchair Van
// Conversion"). Blindly returning the first word conflated the two and leaked
// facet/filter noise ("Yes", "FR", "AT", "Side", "Commercial", "Triple",
// "Adaptive", "Other", "Passenger", "Rear", "Regular", "See", …) into the
// public conversionBrand facet (refs #603).
//
// Sorted longest-first so a full name (e.g. "All Terrain Conversions") wins
// over a shorter one that happens to be a prefix of it.
const KNOWN_CONVERTER_PREFIXES = [
  'BraunAbility', 'Braun',
  'Vantage Mobility International', 'Vantage Mobility', 'Vantage',
  'Freedom Motors',
  'Rollx Vans', 'Rollx',
  'AMS Vans',
  'VMI',
  'MobilityWorks', 'Mobility Works',
  'Driverge',
  'All Terrain Conversions', 'ATC', 'ATS',
  'Tempest',
  'Ryno',
  'Eldorado',
  'Revability', 'Revabilty',
  'MV-1', 'MV1',
  'Northstar',
  'Entervan',
].sort((a, b) => b.length - a.length)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Precompiled once at module load — parseConversionManufacturer runs per card
// during scraping, so building a fresh RegExp per prefix per call is wasted work.
const KNOWN_CONVERTER_PREFIX_PATTERNS: Array<{ name: string; pattern: RegExp }> =
  KNOWN_CONVERTER_PREFIXES.map((name) => ({
    name,
    pattern: new RegExp(`^${escapeRegExp(name)}(?:\\b|$)`, 'i'),
  }))

/**
 * Recognizes a known conversion-manufacturer name at the start of the
 * `conversion` card field. Returns null when no known name is recognized —
 * callers must not fall back to guessing from the first word, since this
 * field frequently describes entry style or uses a single generic word
 * rather than naming a manufacturer. New real converters observed in this
 * field should be added to KNOWN_CONVERTER_PREFIXES (and the matching
 * @wivwav/search KNOWN_CONVERTERS / curated conversion_brands seed entry)
 * once verified, rather than reintroducing a first-word guess.
 */
export function parseConversionManufacturer(text: string): string | null {
  // e.g. "Driverge Driverge Flex Maxx Wheelchair Van Conversion" → cleaned to
  // "Driverge Driverge Flex Maxx", which then matches the "Driverge" prefix below.
  const cleaned = text.replace(/wheelchair van conversion/i, '').trim()
  if (!cleaned) return null

  for (const { name, pattern } of KNOWN_CONVERTER_PREFIX_PATTERNS) {
    if (pattern.test(cleaned)) return name
  }

  return null
}
