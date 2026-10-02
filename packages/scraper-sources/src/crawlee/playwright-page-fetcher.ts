import { createRequire } from 'node:module'
import type { BrowserService } from '../browser/index.js'
import type { BlockableResourceType, WaitUntilState } from '../browser/types.js'
import type { CrawledHtmlPage, CrawledHtmlPageHandler, PageFetcher } from './html-fetcher.js'

// CJS require, not a static ESM import, to match the CheerioAPI type
// Crawlee's own (CJS-resolved) types use for CrawledHtmlPage['$'] — a
// static `import { load } from 'cheerio'` resolves cheerio's ESM types,
// which TS treats as a structurally-incompatible duplicate identity. Same
// workaround already used in mobilityworks.test.ts for the same reason.
const require = createRequire(import.meta.url)
const { load } = require('cheerio') as { load(html: string): CrawledHtmlPage['$'] }

export interface PlaywrightPageFetcherOptions {
  waitUntil?: WaitUntilState
  timeoutMs?: number
  blockResourceTypes?: BlockableResourceType[]
}

/**
 * A real-browser PageFetcher — same CrawledHtmlPage shape as
 * DefaultCrawleeHtmlFetcher (reads page.content() through cheerio.load(),
 * not page.evaluate()), so whichever fetcher produced a page, the same
 * Cheerio-based extraction code handles it (#1041). This is the local
 * fallback a source falls back to when its default Crawlee fetch reports a
 * block (see bot-detector.ts) and a BrowserService is available — not the
 * primary fetch path.
 */
export class PlaywrightPageFetcher implements PageFetcher {
  constructor(
    private readonly browserService: BrowserService,
    private readonly options: PlaywrightPageFetcherOptions = {},
  ) {}

  async fetchOne(url: string): Promise<CrawledHtmlPage> {
    const session = await this.browserService.launch()
    try {
      const page = await session.newPage(
        this.options.blockResourceTypes ? { blockResourceTypes: this.options.blockResourceTypes } : {},
      )
      const response = await page.goto(url, {
        waitUntil: this.options.waitUntil ?? 'domcontentloaded',
        timeout: this.options.timeoutMs ?? 30_000,
      })
      const body = await page.content()
      return {
        url: page.url(),
        body,
        $: load(body),
        statusCode: response?.status() ?? null,
      }
    } finally {
      await session.close()
    }
  }

  /**
   * Sequential, not batched/parallel like Crawlee's crawl() — acceptable
   * because this fetcher is only ever used as an occasional local fallback,
   * not the primary high-volume fetch path.
   */
  async crawl(urls: string[], handler: CrawledHtmlPageHandler): Promise<void> {
    const queue = [...urls]
    const visited = new Set<string>()
    while (queue.length > 0) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)
      const page = await this.fetchOne(url)
      const nextUrls = await handler(page)
      if (nextUrls) {
        for (const next of nextUrls) {
          if (!visited.has(next)) queue.push(next)
        }
      }
    }
  }
}
