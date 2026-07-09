import { createHash } from 'node:crypto'
import type {
  SourceAdapter,
  ScrapeResult,
  StructureCheckResult,
  Page1CheckResult,
} from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition, RampType } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserPage, BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'

const SOURCE_ID = 'mobilityworks'
const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
const BASE_URL = 'https://www.mobilityworks.com'
const LISTINGS_PATH = '/wheelchair-vans-for-sale/'
const PAGE1_SORT_URL = `${BASE_URL}${LISTINGS_PATH}?sortby=yearnew`

interface MobilityWorksConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  browserService?: BrowserService
  /** Override retry backoff for testing — defaults to INITIAL_NAV_BACKOFF_MS. */
  navRetryBackoffMs?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: MobilityWorksConfig = {},
): SourceAdapter {
  return new MobilityWorksAdapter(previousHash, config)
}

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  href: string // e.g. "/wheelchair-vans-for-sale/2024-toyota-sienna-driverge-5tdyrkec8rs205440/"
  title: string // e.g. "Used 2024 Toyota Sienna FWD XLE (New Conversion)"
  price: string // e.g. "$71,991" | "Call for Price" | ""
  stock: string // e.g. "RS205440"
  mileage: string // e.g. "50094"
  color: string // e.g. "Grey"
  convMake: string // e.g. "Driverge"
  conversion: string // e.g. "Rear Entry Manual Fold Out"
  location: string // e.g. "North Las Vegas NV" (market suffix already stripped)
  imageUrl: string
}

export async function evaluateMobilityWorksCards(page: BrowserPage): Promise<RawCard[]> {
  return page.evaluate(
    function ({ baseUrl }: { baseUrl: string }): RawCard[] {
      const results: RawCard[] = []
      const seen = new Set<string>()

      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/wheelchair-vans-for-sale/"]'),
      ).filter(function (a) {
        return /-[A-Za-z0-9]{17}(?:\/)?$/.test(a.getAttribute('href') ?? '')
      })

      for (const anchor of anchors) {
        const href = anchor.getAttribute('href') ?? ''
        if (seen.has(href)) continue
        seen.add(href)

        let container: Element = anchor
        for (let i = 0; i < 6; i++) {
          if (!container.parentElement) break
          const parent = container.parentElement
          if (parent.textContent?.includes('Mileage') || parent.textContent?.includes('Stock:')) {
            container = parent
            break
          }
          container = parent
        }

        const clone = container.cloneNode(true) as Element
        clone.querySelectorAll('sup').forEach(function (s: Element) {
          s.remove()
        })
        const txt = clone.textContent ?? ''
        const sup = /[¹²³⁴-⁹]/g

        const heading = container.querySelector('h2, h3, h4')
        const title = (heading?.textContent ?? anchor.textContent ?? '').trim()

        const imgEl = container.querySelector('img')
        const imgSrc = imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? ''
        const imageUrl = imgSrc.startsWith('http') ? imgSrc : imgSrc ? `${baseUrl}${imgSrc}` : ''

        const rawLocation = (txt.match(/Location\s*:?\s*([^\n]+)/i)?.[1] ?? '')
          .replace(sup, '')
          .replace(/\s*\([^)]+\).*$/, '')
          .replace(/\s+(?:Stock|Mileage|Color|Conv Make|Conversion|Request|Schedule)\b.*/i, '')
          .trim()

        const nextField =
          /\s*(?:Mileage|Color|Conv\s*Make|Conv\b|Conversion|Location|Stock[:\s]|Request|Schedule).*/i
        results.push({
          href,
          title,
          price: (txt.match(/price\s*:?\s*([^\n]+)/i)?.[1] ?? '').replace(sup, '').trim(),
          stock: (txt.match(/Stock\s*:?\s*([^\n]+)/i)?.[1] ?? '')
            .replace(sup, '')
            .replace(/\s.*$/, '')
            .trim(),
          mileage: (txt.match(/Mileage\s*:?\s*([^\n]+)/i)?.[1] ?? '')
            .replace(sup, '')
            .replace(/\s.*$/, '')
            .trim(),
          color: (txt.match(/Color\s*:?\s*([^\n]+)/i)?.[1] ?? '')
            .replace(sup, '')
            .replace(nextField, '')
            .trim(),
          convMake: (txt.match(/Conv Make\s*:?\s*([^\n]+)/i)?.[1] ?? '')
            .replace(sup, '')
            .replace(nextField, '')
            .trim(),
          conversion: (txt.match(/Conversion\s*:?\s*([^\n]+)/i)?.[1] ?? '')
            .replace(sup, '')
            .replace(nextField, '')
            .trim(),
          location: rawLocation,
          imageUrl,
        })
      }

      return results
    },
    { baseUrl: BASE_URL },
  )
}

export class MobilityWorksAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'MobilityWorks'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly browserService: BrowserService | null
  private readonly navRetryBackoffMs: number

  constructor(previousHash: string | null = null, config: MobilityWorksConfig = {}) {
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
        () => page.goto(PAGE1_SORT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
        INITIAL_NAV_MAX_ATTEMPTS,
        this.navRetryBackoffMs,
      )
      await page
        .waitForSelector('a[href*="/wheelchair-vans-for-sale/"]', { timeout: 15_000 })
        .catch(() => {})

      // Hash "vin:price" per listing so a price change triggers a full crawl even
      // when the set of listings on page 1 is unchanged.
      const entries = await page.evaluate(function (): string[] {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/wheelchair-vans-for-sale/"]'),
        ).filter(function (a) {
          return /-[A-Za-z0-9]{17}(?:\/)?$/.test(a.getAttribute('href') ?? '')
        })

        const seen = new Set<string>()
        const results: string[] = []

        for (let i = 0; i < anchors.length; i++) {
          const anchor = anchors[i]!
          const slug =
            (anchor.getAttribute('href') ?? '').replace(/\/+$/, '').split('/').pop() ?? ''
          const slugParts = slug.split('-')
          const vin = (slugParts[slugParts.length - 1] ?? '').toUpperCase()
          if (!/^[A-Z0-9]{17}$/.test(vin) || seen.has(vin)) continue
          seen.add(vin)

          let container: Element = anchor
          for (let j = 0; j < 6; j++) {
            if (!container.parentElement) break
            const parent = container.parentElement
            if (parent.textContent?.includes('Mileage') || parent.textContent?.includes('Stock:')) {
              container = parent
              break
            }
            container = parent
          }

          const clone = container.cloneNode(true) as Element
          clone.querySelectorAll('sup').forEach(function (s: Element) {
            s.remove()
          })
          const txt = clone.textContent ?? ''
          const price = (txt.match(/price\s*:?\s*([^\n]+)/i)?.[1] ?? '').trim()
          results.push(`${vin}:${price}`)
        }

        return results
      })

      const currentHash = createHash('sha256')
        .update(entries.sort().join(',') || 'empty')
        .digest('hex')
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
        () =>
          page.goto(`${BASE_URL}${LISTINGS_PATH}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          }),
        INITIAL_NAV_MAX_ATTEMPTS,
        this.navRetryBackoffMs,
      )
      await page
        .waitForSelector('a[href*="/wheelchair-vans-for-sale/"]', { timeout: 15_000 })
        .catch(() => {})

      const { signature, cardHtml } = await page.evaluate(function (): {
        signature: string
        cardHtml: string
      } {
        const anchors = Array.from(
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/wheelchair-vans-for-sale/"]'),
        ).filter(function (a) {
          return /-[A-Za-z0-9]{17}(?:\/)?$/.test(a.getAttribute('href') ?? '')
        })

        const first = anchors[0]
        if (!first) return { signature: 'no-listings', cardHtml: '' }

        // Walk up to find card container that contains structured listing data
        let container: Element = first
        for (let i = 0; i < 6; i++) {
          if (!container.parentElement) break
          const parent = container.parentElement
          if (parent.textContent?.includes('Mileage') || parent.textContent?.includes('Stock:')) {
            container = parent
            break
          }
          container = parent
        }

        // Iterative DFS — tsx's esbuild injects __name() for named function declarations,
        // which is undefined in the Playwright browser sandbox where only the function body
        // is serialized, not the module-level helper.
        const parts: string[] = []
        const stack: Array<[Element, number]> = [[container, 0]]
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

        return { signature: parts.join(','), cardHtml: container.outerHTML }
      })

      const currentHash = createHash('sha256').update(signature).digest('hex')
      const changed = this.previousHash !== null && this.previousHash !== currentHash
      return {
        changed,
        currentHash,
        previousHash: this.previousHash,
        // Scoped to the listing card itself (not page.content()) so unrelated page-wide
        // markup — e.g. the Osano cookie-consent widget — doesn't crowd out the actual
        // listing structure when the AI remap prompt truncates the sample.
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
      await report(context, '[mobilityworks] Starting listing pagination', {
        stage: 'scraping',
        source: SOURCE_ID,
        page: pageNum,
        listings: 0,
      })

      while (pageNum <= this.maxPages) {
        const url =
          pageNum === 1
            ? `${BASE_URL}${LISTINGS_PATH}`
            : `${BASE_URL}${LISTINGS_PATH}page/${pageNum}/`

        await report(context, `[mobilityworks] Loading listing page ${pageNum}: ${url}`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          listings: listings.length,
        })

        try {
          if (pageNum === 1) {
            await withNavigationRetry(
              () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
              INITIAL_NAV_MAX_ATTEMPTS,
              this.navRetryBackoffMs,
            )
          } else {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          }
        } catch (err) {
          if (pageNum > 1 && isNavigationTimeout(err)) {
            await report(
              context,
              `[mobilityworks] Stopping pagination after timeout loading page ${pageNum}: ${url}`,
              {
                stage: 'scraping',
                source: SOURCE_ID,
                page: pageNum,
                listings: listings.length,
                reason: 'page_timeout',
              },
            )
            break
          }
          throw err
        }
        await page
          .waitForSelector('a[href*="/wheelchair-vans-for-sale/"]', { timeout: 15_000 })
          .catch(() => {})

        const cards = await evaluateMobilityWorksCards(page)

        await report(context, `[mobilityworks] Page ${pageNum} returned ${cards.length} card(s)`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: pageNum,
          cards: cards.length,
          listings: listings.length,
        })

        if (cards.length === 0) {
          await report(
            context,
            `[mobilityworks] No cards found on page ${pageNum}; stopping pagination`,
            {
              stage: 'scraping',
              source: SOURCE_ID,
              page: pageNum,
              listings: listings.length,
              reason: 'no_cards',
            },
          )
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

        await report(
          context,
          `[mobilityworks] Parsed ${parsedOnPage}/${cards.length} card(s) on page ${pageNum}; ${listings.length} listing(s) total`,
          {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            cards: cards.length,
            parsed: parsedOnPage,
            listings: listings.length,
          },
        )

        const hasNext = await page.evaluate(function (nextPageNum: number): boolean {
          return Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).some(function (a) {
            return (
              a.href.includes(`/page/${nextPageNum}/`) ||
              a.textContent?.trim() === String(nextPageNum)
            )
          })
        }, pageNum + 1)

        if (!hasNext) {
          await report(
            context,
            `[mobilityworks] No next page after page ${pageNum}; pagination complete`,
            {
              stage: 'scraping',
              source: SOURCE_ID,
              page: pageNum,
              listings: listings.length,
            },
          )
          break
        }
        pageNum++
      }

      const fingerprintHash = createHash('sha256')
        .update(listings.map((l) => l.vin ?? l.sourceUrl).join('|'))
        .digest('hex')

      return { listings, fingerprintHash }
    } finally {
      await browser.close()
    }
  }
}

export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  // VIN: last hyphen-delimited segment of the URL slug (must be exactly 17 alphanum chars)
  const slug = raw.href.replace(/\/+$/, '').split('/').pop() ?? ''
  const slugParts = slug.split('-')
  const vinCandidate = (slugParts[slugParts.length - 1] ?? '').toUpperCase()
  if (!/^[A-Z0-9]{17}$/.test(vinCandidate)) return null
  const vin = vinCandidate

  // Title: "Used 2024 Toyota Sienna FWD XLE (New Conversion)" — strip trailing parenthetical
  const titleClean = raw.title.replace(/\s*\([^)]+\)\s*$/, '').trim()
  const condPrefix = titleClean.match(/^(Used|New|Certified Pre[- ]Owned|CPO)\s+/i)
  const condition: ListingCondition = condPrefix?.[1]?.toLowerCase() === 'new' ? 'new' : 'used'
  const titleBody = titleClean.replace(/^(Used|New|Certified Pre[- ]Owned|CPO)\s+/i, '').trim()

  const { year, make, model, trim } = parseVehicleTitle(titleBody)

  if (!make || !model || year < 1990 || year > new Date().getFullYear() + 2) return null

  const mileage = parseMileage(raw.mileage)
  const priceCents = parsePrice(raw.price)
  const { city, state } = parseLocation(raw.location)
  const sourceUrl = raw.href.startsWith('http') ? raw.href : `${BASE_URL}${raw.href}`
  const stockNumber = raw.stock || null
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
    color: raw.color || null,
    fuelType: null,
    transmission: null,
    wav: {
      conversionType: parseConversionType(raw.conversion),
      conversionManufacturer: raw.convMake || null,
      floorLoweringInches: null,
      rampType: parseRampType(raw.conversion),
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    },
    location: { zip: null, city, state, lat: null, lng: null },
    dealer: { name: 'MobilityWorks', phone: null, website: BASE_URL },
    images: raw.imageUrl ? [raw.imageUrl] : [],
    description: null,
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

export function parseRampType(text: string): RampType {
  const t = text.toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor') || t.includes('infloor')) return 'in_floor'
  if (t.includes('fold out') || t.includes('fold-out')) return 'fold_out'
  if (t.includes('fold in') || t.includes('fold-in')) return 'fold_in'
  return 'unknown'
}

export function parseLocation(text: string): { city: string | null; state: string | null } {
  // "North Las Vegas NV" → city="North Las Vegas", state="NV"
  // Defensively strip trailing garbage (market suffix parens + anything that bled in from adjacent fields).
  const clean = text
    .replace(/\s*\([^)]+\).*$/, '')
    .replace(/\s+(?:Stock|Mileage|Color|Conv Make|Conversion|Request|Schedule)\b.*/i, '')
    .trim()
  const m = clean.match(/^(.+?)\s+([A-Z]{2})$/)
  if (!m) return { city: clean || null, state: null }
  return { city: m[1]! || null, state: m[2]! || null }
}
