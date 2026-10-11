import { createHash } from 'node:crypto'
import type {
  SourceAdapter,
  ScrapeResult,
  StructureCheckResult,
  Page1CheckResult,
} from '../engine/source-adapter.js'
import type { Listing } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import type { BrowserService } from '../browser/index.js'
import { report } from '../jobs/job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'
import { RobotsCache } from '../util/robots-cache.js'
import { isNavigationTimeout, withNavigationRetry } from '../util/navigation-timeout.js'
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

import { BASE_URL, SOURCE_ID } from './blvd-constants.js'
import {
  extractBlvdStructure,
  hasBlvdNextPage,
  extractBlvdCards,
  hashPage1Entries,
  parseCard,
} from './blvd-parser.js'

export * from './blvd-parser.js'

const INITIAL_NAV_MAX_ATTEMPTS = 3
const INITIAL_NAV_BACKOFF_MS = 1_000
const LISTINGS_PATH = '/wheelchair-vans-for-sale'
const FSBO_LISTINGS_PATH = '/wheelchair-vans-for-sale-by-owner'
const LISTING_PATHS = [LISTINGS_PATH, FSBO_LISTINGS_PATH] as const

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

export { isNavigationTimeout } from '../util/navigation-timeout.js'
