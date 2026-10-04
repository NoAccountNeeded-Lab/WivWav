import { createHash } from 'node:crypto'
import type {
  SourceAdapter,
  ScrapeResult,
  StructureCheckResult,
  Page1CheckResult,
} from '../engine/source-adapter.js'
import type { ConversionType, Listing, ListingCondition } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserPage, BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { RobotsCache } from '../util/robots-cache.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
import { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
import { parseVehicleTitle } from '../lib/parse-vehicle-title.js'
import {
  DefaultCrawleeHtmlFetcher,
  type CrawledHtmlPage,
  type PageFetcher,
} from '../crawlee/html-fetcher.js'
import { PlaywrightPageFetcher } from '../crawlee/playwright-page-fetcher.js'
import { checkForBlock } from '../crawlee/bot-detector.js'
import {
  EscalateCapabilitySignal,
  isEscalateCapabilitySignal,
} from '@wivwav/queue/escalate-capability-signal'

type CheerioAPI = CrawledHtmlPage['$']

const SOURCE_ID = 'blvd'
const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
const BASE_URL = 'https://www.blvd.com'
const LISTINGS_PATH = '/wheelchair-vans-for-sale'
const FSBO_LISTINGS_PATH = '/wheelchair-vans-for-sale-by-owner'
const LISTING_PATHS = [LISTINGS_PATH, FSBO_LISTINGS_PATH] as const
const CARD_SEL = 'div.track_vehicle'

interface BlvdConfig {
  maxPages?: number
  previousPage1Hash?: string | null
  /**
   * Local fallback only (#1041) — used when pageFetcher reports a block and
   * a browser is available on this worker. No longer the primary fetch
   * mechanism; see pageFetcher below.
   */
  browserService?: BrowserService
  /**
   * Primary fetch mechanism. Defaults to a plain-HTTP Crawlee fetch — no
   * Chromium required. When it reports a block (bot-detector.ts) and
   * browserService is configured, BlvdAdapter retries once via
   * PlaywrightPageFetcher wrapping it.
   */
  pageFetcher?: PageFetcher
  /**
   * When true and HTTP reports a block on a worker with no browserService,
   * throw EscalateCapabilitySignal('chromium') so the coordinator can hand the
   * job to a Chromium-capable worker (#1043) instead of failing. Callers must
   * set this to false once a job has already been escalated, so a block after
   * escalation fails instead of looping. Defaults to false: callers that cannot
   * honour an escalation (in-process runs) keep the explicit BlvdBlockedError.
   */
  allowCapabilityEscalation?: boolean
  /** Inject a RobotsCache instance for testing. Defaults to a new RobotsCache(). */
  robotsCache?: RobotsCache
  /** Override retry backoff for testing — defaults to INITIAL_NAV_BACKOFF_MS. */
  requestDelayMs?: number
  navRetryBackoffMs?: number
}

export function createSourceAdapter(previousHash: string | null, config: BlvdConfig = {}): SourceAdapter {
  return new BlvdAdapter(previousHash, config)
}

// Shape returned from page.evaluate — must be JSON-serializable.
export interface RawCard {
  href: string
  fullTitle: string // "2024 Toyota Sienna FWD XLE" from desktop h3
  conversion: string // "Driverge Flex Maxx Wheelchair Van Conversion"
  condition: string // "Used" | "New" from Vehicle Condition indicator, or "" when absent
  miles: string // "50,094"
  price: string // "$71,991" | "Call" | ""
  seller: string // "MobilityWorks"
  location: string // "North Las Vegas, NV"
  imageUrl: string
  dataId: string
}

export async function evaluateBlvdCards(page: BrowserPage): Promise<RawCard[]> {
  return page.evaluate(
    function ({ sel, baseUrl }: { sel: string; baseUrl: string }): RawCard[] {
      const results: RawCard[] = []

      document.querySelectorAll(sel).forEach(function (card) {
        const detailLink = card.querySelector('a.more-van-details-btn') as HTMLAnchorElement | null
        const href = detailLink?.getAttribute('href') ?? ''

        const h3s = Array.from(card.querySelectorAll('h3'))
        const fullTitleH3 = h3s.find(function (h) {
          return /^\d{4}\s/.test(h.textContent?.trim() ?? '')
        })
        const fullTitle = fullTitleH3?.textContent?.trim() ?? ''

        const conversion = card.querySelector('h4.conversion')?.textContent?.trim() ?? ''
        const condEl = card.querySelector(
          '.newusedicon[data-title="Vehicle Condition"]',
        ) as HTMLElement | null
        const condition = condEl === null ? '' : condEl.classList.contains('Used') ? 'Used' : 'New'

        const fields: Record<string, string> = {}
        card.querySelectorAll('div.vlistp').forEach(function (label) {
          const h4 = label.nextElementSibling
          if (h4?.tagName === 'H4') {
            fields[label.textContent?.trim() ?? ''] = h4.textContent?.trim() ?? ''
          }
        })

        const imgEl = card.querySelector('img.img-responsive') as HTMLImageElement | null
        const imgSrc = imgEl?.getAttribute('src') ?? ''
        const imageUrl = imgSrc.startsWith('http') ? imgSrc : imgSrc ? `${baseUrl}${imgSrc}` : ''

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
}

export function extractBlvdCards($: CheerioAPI): RawCard[] {
  return $(CARD_SEL).toArray().map((element) => {
    const card = $(element)
    const fields: Record<string, string> = {}
    card.find('div.vlistp').each((_index, label) => {
      const next = $(label).next('h4')
      if (next.length) fields[$(label).text().trim()] = next.text().trim()
    })
    const condition = card.find('.newusedicon[data-title="Vehicle Condition"]').first()
    const src = card.find('img.img-responsive').first().attr('src') ?? ''
    return {
      href: card.find('a.more-van-details-btn').first().attr('href') ?? '',
      fullTitle: card.find('h3').toArray().map((h) => $(h).text().trim())
        .find((title) => /^\d{4}\s/.test(title)) ?? '',
      conversion: card.find('h4.conversion').first().text().trim(),
      condition: condition.length === 0 ? '' : condition.hasClass('Used') ? 'Used' : 'New',
      miles: fields['Miles'] ?? '',
      price: fields['Price'] ?? '',
      seller: fields['Seller'] ?? '',
      location: fields['Loc.'] ?? '',
      imageUrl: src.startsWith('http') ? src : src ? `${BASE_URL}${src}` : '',
      dataId: card.attr('data-id') ?? '',
    }
  })
}

export function extractBlvdStructure($: CheerioAPI): { signature: string; cardHtml: string } {
  const cards = $(CARD_SEL)
  const first = cards.first()
  if (!first.length) return { signature: 'no-cards', cardHtml: '' }
  const parts: string[] = []
  const stack = [{ element: first, depth: 0 }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (!item || item.depth > 3) continue
    parts.push(`${item.element.prop('tagName')?.toUpperCase()}[${item.element.attr('class') ?? ''}]`)
    const children = item.element.children().toArray()
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (child) stack.push({ element: $(child), depth: item.depth + 1 })
    }
  }
  return { signature: `count:${cards.length}|${parts.join(',')}`, cardHtml: $.html(first) }
}

export function hasBlvdNextPage($: CheerioAPI): boolean {
  return $('a').toArray().some((a) => $(a).text().trim() === 'Next')
}

export class BlvdBlockedError extends Error {
  constructor(url: string, reason: string | null) {
    super(`[blvd] Blocked fetching ${url}: ${reason ?? 'unknown'}; Chromium fallback unavailable or blocked`)
    this.name = 'BlvdBlockedError'
  }
}

export class BlvdAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'BLVD.com'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly maxPages: number
  private readonly browserService: BrowserService | null
  private readonly pageFetcher: PageFetcher
  private readonly robotsCache: RobotsCache
  private readonly navRetryBackoffMs: number
  private readonly requestDelayMs: number
  private readonly allowCapabilityEscalation: boolean
  private hasFetched = false

  constructor(previousHash: string | null = null, config: BlvdConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.maxPages = config.maxPages ?? Infinity
    this.browserService = config.browserService ?? null
    this.pageFetcher = config.pageFetcher ?? new DefaultCrawleeHtmlFetcher()
    this.robotsCache = config.robotsCache ?? new RobotsCache()
    this.navRetryBackoffMs = config.navRetryBackoffMs ?? INITIAL_NAV_BACKOFF_MS
    this.requestDelayMs = config.requestDelayMs ?? 1_000
    this.allowCapabilityEscalation = config.allowCapabilityEscalation ?? false
  }

  private async fetchWithFallback(url: string, context?: JobContext): Promise<CrawledHtmlPage> {
    if (!await this.robotsCache.isAllowed(url, 'WivWav/1.0')) {
      throw new Error(`[blvd] robots.txt disallows ${url}`)
    }
    const robotsDelayMs = (await this.robotsCache.getCrawlDelay?.(url, 'WivWav/1.0') ?? 0) * 1_000
    // ±20% jitter must never shorten the minimum published by robots.txt.
    const delayMs = Math.max(this.requestDelayMs, robotsDelayMs * 1.25)
    if (this.hasFetched) await jitteredSleep(delayMs)
    this.hasFetched = true
    const page = await this.pageFetcher.fetchOne(url)
    const block = checkForBlock(page.statusCode, page.body)
    if (!block.blocked) return page
    if (!this.browserService) {
      if (this.allowCapabilityEscalation) {
        throw new EscalateCapabilitySignal(
          'chromium',
          `[blvd] blocked over HTTP fetching ${url}: ${block.reason ?? 'unknown'}`,
        )
      }
      throw new BlvdBlockedError(url, block.reason)
    }
    await report(context, `[blvd] Block detected (${block.reason}); retrying with Chromium: ${url}`, {
      stage: 'scraping', source: SOURCE_ID, reason: 'chromium_fallback',
    })
    await jitteredSleep(delayMs)
    const fallback = await new PlaywrightPageFetcher(this.browserService, {
      blockResourceTypes: ['image', 'media', 'font', 'stylesheet'],
    }).fetchOne(url)
    const fallbackBlock = checkForBlock(fallback.statusCode, fallback.body)
    if (fallbackBlock.blocked) throw new BlvdBlockedError(url, fallbackBlock.reason)
    return fallback
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const entries: string[] = []
    for (const listingPath of LISTING_PATHS) {
      let page: CrawledHtmlPage
      try {
        page = await this.fetchWithFallback(getPage1CheckUrl(listingPath))
      } catch (err) {
        if (isNavigationTimeout(err)) continue
        throw err
      }
      for (const card of extractBlvdCards(page.$)) {
        if (card.dataId) entries.push(`${listingPath}:${card.dataId}:${card.price}`)
      }
    }
    const currentHash = hashPage1Entries(entries)
    return { currentHash, changed: this.previousPage1Hash === null || this.previousPage1Hash !== currentHash }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const page = await withNavigationRetry(
      () => this.fetchWithFallback(`${BASE_URL}${LISTINGS_PATH}`),
      INITIAL_NAV_MAX_ATTEMPTS, this.navRetryBackoffMs,
    )
    const { signature, cardHtml } = extractBlvdStructure(page.$)
    const currentHash = createHash('sha256').update(signature).digest('hex')
    const changed = this.previousHash !== null && this.previousHash !== currentHash
    return {
      changed, currentHash, previousHash: this.previousHash,
      ...(changed ? { sampleHtml: cardHtml } : {}),
    }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []
    const robots = this.robotsCache

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

        let page: CrawledHtmlPage
        try {
          page = pageNum === 1
            ? await withNavigationRetry(
              () => this.fetchWithFallback(url, context),
              INITIAL_NAV_MAX_ATTEMPTS, this.navRetryBackoffMs,
            )
            : await this.fetchWithFallback(url, context)
        } catch (err) {
          if (pageNum > 1 && !(err instanceof BlvdBlockedError) && !isEscalateCapabilitySignal(err)) {
            // Any nav failure this deep in pagination (timeout, net::ERR_ABORTED,
            // a stealth-plugin evasion racing page teardown, etc.) should stop
            // pagination gracefully rather than rethrow — rethrowing here aborts
            // the whole run and discards every listing already collected across
            // potentially dozens of prior pages. Page 1 stays strict (via
            // withNavigationRetry, which only retries timeouts) since a page 1
            // failure means zero listings for this path regardless.
            const message = err instanceof Error ? err.message : String(err)
            await report(
              context,
              `[blvd] Stopping pagination after error loading page ${pageNum}: ${url} (${message})`,
              {
                stage: 'scraping',
                source: SOURCE_ID,
                page: pageNum,
                listings: listings.length,
                reason: isNavigationTimeout(err) ? 'page_timeout' : 'page_error',
              },
            )
            break
          }
          throw err
        }

        const cards = extractBlvdCards(page.$)

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

        await report(
          context,
          `[blvd] Parsed ${parsedOnPage}/${cards.length} card(s) on page ${pageNum}; ${listings.length} listing(s) total`,
          {
            stage: 'scraping',
            source: SOURCE_ID,
            page: pageNum,
            cards: cards.length,
            parsed: parsedOnPage,
            listings: listings.length,
          },
        )

        const hasNext = hasBlvdNextPage(page.$)

        if (!hasNext) {
          await report(
            context,
            `[blvd] No next page after page ${pageNum}; pagination complete`,
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
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map((l) => l.vin ?? l.sourceUrl).join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
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
  return createHash('sha256')
    .update(entries.sort().join(',') || 'empty')
    .digest('hex')
}

export { isNavigationTimeout } from '../util/navigation-timeout.js'

export function parseCard(raw: RawCard): Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'> | null {
  // Condition must be determinable — skip cards where the selector was absent to
  // avoid fabricating a 'new' value for vehicles that are actually used.
  if (raw.condition === '') return null

  // "2024 Toyota Sienna FWD XLE" → year, make, model, trim
  const { year, make, model, trim } = parseVehicleTitle(raw.fullTitle)

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

  const locationParts = raw.location.split(',').map((s) => s.trim())
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
  'BraunAbility',
  'Braun',
  'Vantage Mobility International',
  'Vantage Mobility',
  'Vantage',
  'Freedom Motors',
  'Rollx Vans',
  'Rollx',
  'AMS Vans',
  'VMI',
  'MobilityWorks',
  'Mobility Works',
  'Driverge',
  'All Terrain Conversions',
  'ATC',
  'ATS',
  'Tempest',
  'Ryno',
  'Eldorado',
  'Revability',
  'Revabilty',
  'MV-1',
  'MV1',
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
