import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition, RampType } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/db'
import { isVehicleImageUrl } from './image-filter.js'

const SOURCE_ID = 'superior-van'
const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
// Canonical host is bare (no www) — https://www.superiorvan.com/robots.txt 301s
// to https://superiorvan.com/robots.txt, and the listing grid resolves the same way.
const BASE_URL = 'https://superiorvan.com'
const LISTINGS_PATH = '/inventory/'
const NAVIGATION_TIMEOUT_MS = 30_000
// Distinguishes vehicle cards from the unrelated "find a location" loop grid that
// the same /inventory/ page also renders (both use the generic Elementor
// `e-loop-item` wrapper class).
const CARD_SEL = 'div.e-loop-item.inventory'

// Robots.txt review (2026-07-03): https://superiorvan.com/robots.txt disallows only
// /wp-admin/ (admin-ajax.php explicitly re-allowed). /inventory/ and its FacetWP query
// parameters (?_paged=, ?_condition=, …) are unrestricted, and no crawl-delay is set.
// Pagination is server-rendered via ?_paged=N (verified: distinct listings returned
// per page), so this adapter uses plain page.goto() navigation rather than driving
// FacetWP's AJAX refresh endpoint through UI interaction.

const DEALER_NAME = 'Superior Van & Mobility'
const DEALER_PHONE = '(844) 341-5438'

// Known, review-verified WAV conversion manufacturers (mirrors the allowlist in
// packages/search/src/canonicalize.ts KNOWN_CONVERTERS). Superior Van's "Conversion
// By:" field names brands outside that list too (e.g. "FR Conversions", "Adaptive
// Vans", and the catch-all "Additional Manufacturers"); rather than pass unverified
// names through, this map only accepts names already recognized downstream and
// normalizes known variants (e.g. the parenthetical "Vantage Mobility (VMI)") to the
// canonical form. Anything unmapped returns null — never a fabricated/guessed value.
const KNOWN_MANUFACTURER_MAP: Record<string, string> = {
  'braunability': 'BraunAbility',
  'vantage mobility (vmi)': 'VMI',
  'vantage mobility': 'VMI',
  'vmi': 'VMI',
  'driverge vehicle innovations': 'Driverge',
  'driverge': 'Driverge',
  'ams vans and mobility': 'AMS Vans',
  'ams vans': 'AMS Vans',
  'freedom motors': 'Freedom Motors',
  'rollx vans': 'Rollx Vans',
  'rollx': 'Rollx Vans',
}

interface SuperiorVanConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  browserService?: BrowserService
  /** Override retry backoff for testing — defaults to INITIAL_NAV_BACKOFF_MS. */
  navRetryBackoffMs?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: SuperiorVanConfig = {},
): SourceAdapter {
  return new SuperiorVanAdapter(previousHash, config)
}

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  href: string           // e.g. "https://superiorvan.com/inventory/2010-vantage-mobility-vmi-chrysler-town-country-2a4rr4de0ar108839/"
  fullTitle: string       // e.g. "2010 Vantage Mobility (VMI) Chrysler Town & Country LX"
  conditionLabel: string  // e.g. "Used" | "New" | "Pre-Owned" | "" when the badge is absent
  className: string       // full class list of the card container, e.g. "... make-chrysler ramp-location-side-entry ramp-type-power-in-floor ..."
  fields: Record<string, string> // label→value pairs, e.g. { Stock: 'AR108839', Trim: 'LX', Mileage: '94,211', 'Conversion By': 'Vantage Mobility (VMI)' }
  priceText: string       // e.g. "$31,900"
  webSpecialText: string  // e.g. "Web Special: $29,900" or "" when absent
  imageUrl: string
}

export class SuperiorVanAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'Superior Van & Mobility'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly browserService: BrowserService | null
  private readonly navRetryBackoffMs: number

  constructor(previousHash: string | null = null, config: SuperiorVanConfig = {}) {
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

      // Hash "vin:price" per card so a price change triggers a full crawl even
      // when the set of listings on page 1 is unchanged.
      const entries = await page.evaluate(function (sel: string): string[] {
        const results: string[] = []
        document.querySelectorAll(sel).forEach(function (card) {
          const href = card.querySelector('a.vehicle-card-image')?.getAttribute('href') ?? ''
          if (!href) return

          let priceText = ''
          let webSpecialText = ''
          card.querySelectorAll('h2.elementor-heading-title').forEach(function (h2) {
            if (h2.querySelector('a')) return // the title heading, not a price heading
            const text = h2.textContent?.trim() ?? ''
            if (/^web special/i.test(text)) webSpecialText = text
            else if (text) priceText = text
          })

          results.push(`${href}:${webSpecialText || priceText}`)
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
      const page = await browser.newPage({
        blockResourceTypes: ['image', 'media', 'font', 'stylesheet'],
      })
      let pageNum = 1
      await report(context, '[superior-van] Starting listing pagination', {
        stage: 'scraping',
        source: SOURCE_ID,
        page: pageNum,
        listings: 0,
      })

      while (pageNum <= this.maxPages) {
        const url = pageNum === 1 ? `${BASE_URL}${LISTINGS_PATH}` : `${BASE_URL}${LISTINGS_PATH}?_paged=${pageNum}`

        await report(context, `[superior-van] Loading listing page ${pageNum}: ${url}`, {
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
            await report(context, `[superior-van] Stopping pagination after timeout loading page ${pageNum}: ${url}`, {
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
            const href = card.querySelector('a.vehicle-card-image')?.getAttribute('href') ?? ''
            const conditionLabel = card.querySelector('h5.elementor-heading-title')?.textContent?.trim() ?? ''
            const className = card.className

            let fullTitle = ''
            let priceText = ''
            let webSpecialText = ''
            card.querySelectorAll('h2.elementor-heading-title').forEach(function (h2) {
              const link = h2.querySelector('a')
              if (link) {
                fullTitle = link.textContent?.trim() ?? ''
                return
              }
              const text = h2.textContent?.trim() ?? ''
              if (/^web special/i.test(text)) webSpecialText = text
              else if (text) priceText = text
            })

            // Label:value pairs appear in two DOM shapes on this page: inline
            // icon-list items (Ramp Location, Stock, Trim) and bare text-editor
            // widgets (Mileage, Conversion By). Both use a bold label span
            // immediately followed by the value as plain text.
            const fields: Record<string, string> = {}
            function collectLabelValue(el: Element): void {
              const boldSpan = el.querySelector('span[style*="font-weight"]')
              if (!boldSpan) return
              const boldText = boldSpan.textContent ?? ''
              const fullText = el.textContent ?? ''
              const value = fullText.startsWith(boldText)
                ? fullText.slice(boldText.length).trim()
                : fullText.replace(boldText, '').trim()
              const label = boldText.trim().replace(/:$/, '')
              if (label) fields[label] = value
            }
            card.querySelectorAll('.elementor-icon-list-text').forEach(collectLabelValue)
            card.querySelectorAll('.elementor-widget-text-editor').forEach(collectLabelValue)

            const imgEl = card.querySelector('a.vehicle-card-image img') as HTMLImageElement | null
            const imageUrl = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? ''

            results.push({ href, fullTitle, conditionLabel, className, fields, priceText, webSpecialText, imageUrl })
          })

          return results
        }, CARD_SEL)

        await report(context, `[superior-van] Page ${pageNum} returned ${cards.length} card(s)`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          cards: cards.length,
          listings: listings.length,
        })

        if (cards.length === 0) {
          await report(context, `[superior-van] No cards found on page ${pageNum}; stopping pagination`, {
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

        await report(context, `[superior-van] Parsed ${parsedOnPage}/${cards.length} card(s) on page ${pageNum}; ${listings.length} listing(s) total`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          cards: cards.length,
          parsed: parsedOnPage,
          listings: listings.length,
        })

        // Belt-and-suspenders alongside the cards.length===0 check above: if a
        // future FacetWP/theme change clamps out-of-range pagination to the last
        // page instead of rendering an empty grid, cards.length would never reach
        // 0 and this loop would otherwise run until maxPages (Infinity in
        // production). The FacetWP pager markup is injected by client-side JS
        // from preloaded config (it is not present in the raw server response),
        // so give it a moment to hydrate before reading it — a pager that never
        // appears is treated as "no next page" rather than retried, which fails
        // toward stopping early rather than looping unbounded.
        await page.waitForSelector('.facetwp-pager a', { timeout: 5_000 }).catch(() => {})
        const hasNext = await page.evaluate(function (): boolean {
          const pager = document.querySelector('.facetwp-pager')
          if (!pager) return false
          return Array.from(pager.querySelectorAll('a')).some(function (a) {
            return a.className.includes('next')
          })
        })

        if (!hasNext) {
          await report(context, `[superior-van] No next-page link after page ${pageNum}; pagination complete`, {
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

function extractClassToken(className: string, prefix: string): string {
  const token = className.split(/\s+/).find(c => c.startsWith(prefix))
  return token ? token.slice(prefix.length) : ''
}

function capitalizeWord(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  if (!raw.href || !raw.fullTitle) return null

  const titleParts = raw.fullTitle.trim().split(/\s+/)
  const year = parseInt(titleParts[0] ?? '0', 10)
  if (Number.isNaN(year) || year < 1990 || year > new Date().getFullYear() + 2) return null

  const makeSlug = extractClassToken(raw.className, 'make-')
  const make = capitalizeWord(makeSlug)
  if (!make) return null

  const rest = titleParts.slice(1).join(' ')
  const makePattern = new RegExp(`\\b${escapeRegExp(make)}\\b`, 'i')
  const makeMatch = makePattern.exec(rest)
  const afterMake = makeMatch ? rest.slice(makeMatch.index + makeMatch[0].length).trim() : rest.trim()

  const trimText = raw.fields['Trim'] ?? ''
  let model: string
  let trim: string | null
  if (trimText && afterMake.toLowerCase().endsWith(trimText.toLowerCase())) {
    model = afterMake.slice(0, afterMake.length - trimText.length).trim()
    trim = trimText
  } else {
    model = afterMake
    trim = trimText || null
  }

  if (!model) return null

  // VIN is the trailing 17-character alphanumeric segment of the slug, with no
  // internal hyphens (e.g. "...-2a4rr4de0ar108839").
  const slug = raw.href.replace(/\/+$/, '').split('/').pop() ?? ''
  const vinCandidate = (slug.split('-').pop() ?? '').toUpperCase()
  const normalizedVin = normalizeVin(vinCandidate)
  const qualityIssueCodes: string[] = []

  let vin: string | null
  if (!isValidVin(normalizedVin)) {
    vin = null
    qualityIssueCodes.push('unparseable_vin')
  } else if (!checkDigitValid(normalizedVin)) {
    vin = normalizedVin
    qualityIssueCodes.push('invalid_check_digit')
  } else {
    vin = normalizedVin
  }

  const conditionKey = raw.conditionLabel.trim().toLowerCase()
  const condition: ListingCondition = conditionKey === 'new' ? 'new' : 'used'

  const rampLocationSlug = extractClassToken(raw.className, 'ramp-location-')
  const conversionType = parseConversionType(rampLocationSlug.replace(/-/g, ' '))

  const rampTypeSlug = extractClassToken(raw.className, 'ramp-type-')
  const rampType = parseRampType(rampTypeSlug)

  const conversionManufacturer = parseConversionManufacturer(raw.fields['Conversion By'] ?? '')
  const mileage = parseMileage(raw.fields['Mileage'] ?? '')
  const priceCents = parsePrice(
    raw.webSpecialText ? raw.webSpecialText.replace(/^web special:?\s*/i, '') : raw.priceText,
  )

  const stockNumber = raw.fields['Stock'] || null
  const sourceUrl = raw.href
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
    transmission: null,
    wav: {
      conversionType,
      conversionManufacturer,
      floorLoweringInches: null,
      rampType,
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city: null, state: null, lat: null, lng: null },
    dealer: { name: DEALER_NAME, phone: DEALER_PHONE, website: BASE_URL },
    // "Coming Soon" placeholder graphics (observed for vehicles awaiting photos)
    // aren't caught by image-filter.ts's generic non-vehicle patterns, so this
    // source checks for that filename convention in addition to the shared filter.
    images:
      raw.imageUrl && isVehicleImageUrl(raw.imageUrl) && !/coming[-_]?soon/i.test(raw.imageUrl)
        ? [raw.imageUrl]
        : [],
    description: null,
    ...(qualityIssueCodes.length > 0 ? { qualityIssueCodes } : {}),
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date(),
    sourceListedAt: null,
    sourceUpdatedAt: null,
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

export function parseRampType(slug: string): RampType {
  const t = slug.toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor')) return 'in_floor'
  if (t.includes('fold-out') || t.includes('fold out')) return 'fold_out'
  if (t.includes('fold-in') || t.includes('fold in')) return 'fold_in'
  return 'unknown'
}

export function parseConversionManufacturer(text: string): string | null {
  const key = text.trim().toLowerCase()
  return KNOWN_MANUFACTURER_MAP[key] ?? null
}
