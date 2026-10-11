import { createHash } from 'node:crypto'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from '../engine/source-adapter.js'
import type { Listing } from '@wivwav/types'
import type { JobContext } from '@wivwav/queue'
import { report } from '../jobs/job-progress.js'
import { RobotsCache } from '../util/robots-cache.js'
import { jitteredSleep } from '../util/jitter-sleep.js'

import { BASE_URL, MAIN_BROWSE_PATH, SOURCE_ID, USER_AGENT } from './mobility-van-sales-constants.js'
import { defaultFetchPage, type FetchPage, type FetchResult } from './mobility-van-sales-fetch.js'
import { buildDiscoveryIndexUrls, extractBrowseAdIds, extractSecondaryBrowseUrls } from './mobility-van-sales-discovery.js'
import {
  buildListing,
  hashPage1Entries,
  parseBrowsePageHtml,
  parseDetailPageHtml,
} from './mobility-van-sales-parser.js'

export * from './mobility-van-sales-parser.js'
export * from './mobility-van-sales-discovery.js'
export type { FetchPage, FetchResult } from './mobility-van-sales-fetch.js'

const DEFAULT_DETAIL_FETCH_DELAY_MS = 1_500
const DEFAULT_INDEX_FETCH_DELAY_MS = 750

// Robots.txt review (2026-09-02, ahead of #1002): https://www.mobilityvansales.com/robots.txt
// disallows /search-used-handicapvans.html and /search-used-handicapvans/search.html
// (pagination POST/GET search endpoint) for User-agent: *. Does not disallow /buy/*.htm
// detail pages, /used-handicap-vans/*.html category browse pages, or /search/*.html
// make/state index pages. No crawl-delay directive is set.
//
// Terms review (same date): /legal/terms_conditions.html includes a "No Automated Querying"
// clause — flagged on #1002 for product/legal awareness; this adapter honors robots.txt
// disallows, uses referral-only buyerUrl, and never extracts seller phone/email fields.
//
// TLS review (same date): the site's certificate is expired; Node's default fetch() fails
// validation. defaultFetchPage() uses an origin-scoped HTTPS agent with rejectUnauthorized:
// false for mobilityvansales.com only so crawls can proceed until the site renews its cert.

interface MobilityVanSalesConfig {
  previousPage1Hash?: string | null
  robotsCache?: RobotsCache
  fetchPage?: FetchPage
  detailFetchDelayMs?: number
  indexFetchDelayMs?: number
  maxListings?: number
}

export function createSourceAdapter(
  previousHash: string | null,
  config: MobilityVanSalesConfig = {},
): SourceAdapter {
  return new MobilityVanSalesAdapter(previousHash, config)
}

export class MobilityVanSalesAdapter implements SourceAdapter {
  readonly sourceId = SOURCE_ID
  readonly name = 'MobilityVanSales'

  private readonly previousHash: string | null
  private readonly previousPage1Hash: string | null
  private readonly robotsCache: RobotsCache
  private readonly fetchPage: FetchPage
  private readonly detailFetchDelayMs: number
  private readonly indexFetchDelayMs: number
  private readonly maxListings: number

  constructor(previousHash: string | null = null, config: MobilityVanSalesConfig = {}) {
    this.previousHash = previousHash
    this.previousPage1Hash = config.previousPage1Hash ?? null
    this.robotsCache = config.robotsCache ?? new RobotsCache()
    this.fetchPage = config.fetchPage ?? defaultFetchPage
    this.detailFetchDelayMs = config.detailFetchDelayMs ?? DEFAULT_DETAIL_FETCH_DELAY_MS
    this.indexFetchDelayMs = config.indexFetchDelayMs ?? DEFAULT_INDEX_FETCH_DELAY_MS
    this.maxListings = config.maxListings ?? Infinity
  }

  private async fetchAllowed(url: string, context?: JobContext, logPrefix?: string): Promise<FetchResult | null> {
    const allowed = await this.robotsCache.isAllowed(url, USER_AGENT)
    if (!allowed) {
      await report(context, `${logPrefix ?? '[mobility-van-sales]'} robots.txt disallows ${url} — skipping`, {
        stage: 'scraping',
        source: SOURCE_ID,
        reason: 'robots_disallowed',
      })
      return null
    }
    return this.fetchPage(url)
  }

  async checkPage1(): Promise<Page1CheckResult> {
    const result = await this.fetchPage(`${BASE_URL}${MAIN_BROWSE_PATH}`)
    const adIds = extractBrowseAdIds(result.text)
    const currentHash = hashPage1Entries(adIds)
    const changed = this.previousPage1Hash === null || this.previousPage1Hash !== currentHash
    return { currentHash, changed }
  }

  async checkStructure(): Promise<StructureCheckResult> {
    const browse = await this.fetchPage(`${BASE_URL}${MAIN_BROWSE_PATH}`)
    const cards = parseBrowsePageHtml(browse.text)
    const sampleUrl = cards[0]?.detailUrl
    if (!sampleUrl) {
      throw new Error('[mobility-van-sales] Main browse page returned zero parseable cards for structure check')
    }

    const detail = await this.fetchPage(sampleUrl)
    const parsed = parseDetailPageHtml(detail.text)
    const signature = `badges:${Object.keys(parsed.fields).sort().join(',')}|seller:${parsed.sellerType ?? 'none'}`

    const currentHash = createHash('sha256').update(signature).digest('hex')
    const changed = this.previousHash !== null && this.previousHash !== currentHash
    return {
      changed,
      currentHash,
      previousHash: this.previousHash,
      ...(changed ? { sampleHtml: detail.text } : {}),
    }
  }

  async scrape(context?: JobContext): Promise<ScrapeResult> {
    const listings: Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>[] = []
    const detailUrls = new Set<string>()

    await report(context, '[mobility-van-sales] Discovering listing detail URLs from browse indexes', {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    const indexUrls = buildDiscoveryIndexUrls()
    const visitedIndexes = new Set<string>()
    const pendingIndexes = [...indexUrls]

    while (pendingIndexes.length > 0) {
      const indexUrl = pendingIndexes.shift()!
      if (visitedIndexes.has(indexUrl)) continue
      visitedIndexes.add(indexUrl)

      const result = await this.fetchAllowed(indexUrl, context, '[mobility-van-sales]')
      if (result === null || result.status !== 200) continue

      for (const card of parseBrowsePageHtml(result.text)) {
        detailUrls.add(card.detailUrl)
      }

      for (const secondary of extractSecondaryBrowseUrls(result.text)) {
        const absolute = secondary.startsWith('http') ? secondary : `${BASE_URL}${secondary}`
        if (!visitedIndexes.has(absolute) && !pendingIndexes.includes(absolute)) {
          pendingIndexes.push(absolute)
        }
      }

      if (pendingIndexes.length > 0) await jitteredSleep(this.indexFetchDelayMs)
    }

    const urls = [...detailUrls].slice(0, this.maxListings)

    await report(context, `[mobility-van-sales] Discovered ${urls.length} unique detail URL(s)`, {
      stage: 'scraping',
      source: SOURCE_ID,
      listings: 0,
    })

    for (let i = 0; i < urls.length; i++) {
      const detailUrl = urls[i]!
      const result = await this.fetchAllowed(detailUrl, context, '[mobility-van-sales]')
      if (result === null) continue

      if (result.status === 404) {
        await report(context, `[mobility-van-sales] ${detailUrl} is gone (404) — skipping`, {
          stage: 'scraping',
          source: SOURCE_ID,
          reason: 'not_found',
        })
      } else if (result.status === 200) {
        const listing = buildListing(parseDetailPageHtml(result.text), result.url)
        if (listing) listings.push(listing)
      }

      if ((i + 1) % 25 === 0 || i === urls.length - 1) {
        await report(context, `[mobility-van-sales] Fetched ${i + 1}/${urls.length} detail page(s); ${listings.length} listing(s) so far`, {
          stage: 'scraping',
          source: SOURCE_ID,
          page: i + 1,
          listings: listings.length,
        })
      }

      if (i < urls.length - 1) await jitteredSleep(this.detailFetchDelayMs)
    }

    const fingerprintHash = createHash('sha256')
      .update(listings.map(l => l.sourceRecordKey).sort().join('|'))
      .digest('hex')

    return { listings, fingerprintHash }
  }
}
