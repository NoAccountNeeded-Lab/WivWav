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
import { DefaultCrawleeHtmlFetcher } from '../crawlee/html-fetcher.js'
import type { CrawleeHtmlFetcher, CrawledHtmlPage } from '../crawlee/html-fetcher.js'
import { report } from '../jobs/job-progress.js'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'

const SOURCE_ID = 'mobilityworks'
const BASE_URL = 'https://www.mobilityworks.com'
const LISTINGS_PATH = '/wheelchair-vans-for-sale/'
const PAGE1_SORT_URL = `${BASE_URL}${LISTINGS_PATH}?sortby=yearnew`

interface MobilityWorksConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  htmlFetcher?: CrawleeHtmlFetcher
  /**
   * @deprecated Use htmlFetcher. Retained only for older unit tests during the
   * Crawlee migration; production no longer uses Playwright for MobilityWorks.
   */
  browserService?: BrowserService
  /** @deprecated Playwright retry backoff is unused after the Crawlee migration. */
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

export function extractMobilityWorksCards($: CrawledHtmlPage['$']): RawCard[] {
  const results: RawCard[] = []
  const seen = new Set<string>()

  $('a[href*="/wheelchair-vans-for-sale/"]').each((_index, anchor) => {
    const href = $(anchor).attr('href') ?? ''
    if (!/-[A-Za-z0-9]{17}(?:\/)?$/.test(href) || seen.has(href)) return
    seen.add(href)

    let container = $(anchor)
    for (let i = 0; i < 6; i++) {
      const parent = container.parent()
      if (parent.length === 0) break
      const text = parent.text()
      container = parent
      if (text.includes('Mileage') || text.includes('Stock:')) break
    }

    const clone = container.clone()
    clone.find('sup').remove()
    const txt = clone.text()
    const sup = /[¹²³⁴-⁹]/g
    const heading = container.find('h2, h3, h4').first()
    const title = (heading.text() || $(anchor).text()).trim()
    const imgEl = container.find('img').first()
    const imgSrc = imgEl.attr('src') ?? imgEl.attr('data-src') ?? ''
    const imageUrl = imgSrc.startsWith('http') ? imgSrc : imgSrc ? `${BASE_URL}${imgSrc}` : ''
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
  })

  return results
}

function extractPage1Entries($: CrawledHtmlPage['$']): string[] {
  const entries: string[] = []
  const seen = new Set<string>()
  const cards = extractMobilityWorksCards($)
  for (const card of cards) {
    const slug = card.href.replace(/\/+$/, '').split('/').pop() ?? ''
    const slugParts = slug.split('-')
    const vin = (slugParts[slugParts.length - 1] ?? '').toUpperCase()
    if (!/^[A-Z0-9]{17}$/.test(vin) || seen.has(vin)) continue
    seen.add(vin)
    entries.push(`${vin}:${card.price}`)
  }
  return entries
}

function extractStructureSignature($: CrawledHtmlPage['$']): { signature: string; cardHtml: string } {
  const first = $('a[href*="/wheelchair-vans-for-sale/"]')
    .filter((_index, anchor) => /-[A-Za-z0-9]{17}(?:\/)?$/.test($(anchor).attr('href') ?? ''))
    .first()

  if (first.length === 0) return { signature: 'no-listings', cardHtml: '' }

  let container = first
  for (let i = 0; i < 6; i++) {
    const parent = container.parent()
    if (parent.length === 0) break
    container = parent
    const text = parent.text()
    if (text.includes('Mileage') || text.includes('Stock:')) break
  }

  const parts: string[] = []
  const stack = [{ element: container, depth: 0 }]
  while (stack.length > 0) {
    const { element, depth } = stack.pop()!
    if (depth > 3 || element.length === 0) continue
    const node = element.get(0)
    if (!node || node.type !== 'tag') continue
    parts.push(`${node.tagName}[${$(node).attr('class') ?? ''}]`)
    const children = element.children().toArray()
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ element: $(children[i]!), depth: depth + 1 })
    }
  }

  return { signature: parts.join(','), cardHtml: $.html(container) }
}

function hasNextPage($: CrawledHtmlPage['$'], nextPageNum: number): boolean {
  return $('a')
    .toArray()
    .some((anchor) => {
      const href = $(anchor).attr('href') ?? ''
      return href.includes(`/page/${nextPageNum}/`) || $(anchor).text().trim() === String(nextPageNum)
    })
}

export class MobilityWorksAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'MobilityWorks'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly htmlFetcher: CrawleeHtmlFetcher

  constructor(previousHash: string | null = null, config: MobilityWorksConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.maxPages = config.maxPages ?? Infinity
    this.htmlFetcher = config.htmlFetcher ?? new DefaultCrawleeHtmlFetcher()
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const page = await this.htmlFetcher.fetchOne(PAGE1_SORT_URL)
    // Hash "vin:price" per listing so a price change triggers a full crawl even
    // when the set of listings on page 1 is unchanged.
    const entries = extractPage1Entries(page.$)
    const currentHash = createHash('sha256')
      .update(entries.sort().join(',') || 'empty')
      .digest('hex')
    const changed = this.previousPage1Hash === null || this.previousPage1Hash !== currentHash
    return { currentHash, changed }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const page = await this.htmlFetcher.fetchOne(`${BASE_URL}${LISTINGS_PATH}`)
    const { signature, cardHtml } = extractStructureSignature(page.$)
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
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []

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

      const page = await this.htmlFetcher.fetchOne(url)
      const cards = extractMobilityWorksCards(page.$)

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

      if (!hasNextPage(page.$, pageNum + 1)) {
        await report(context, `[mobilityworks] No next page after page ${pageNum}; pagination complete`, {
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
      .update(listings.map((l) => l.vin ?? l.sourceUrl).join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
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
