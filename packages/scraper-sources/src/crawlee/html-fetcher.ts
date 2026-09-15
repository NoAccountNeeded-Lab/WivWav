import { createRequire } from 'node:module'
import { CheerioCrawler, Configuration, log as crawleeLog } from 'crawlee'
import type { CheerioCrawlingContext, CheerioCrawlerOptions } from 'crawlee'

const require = createRequire(import.meta.url)
const robotsParser: (url: string, text: string) => {
  getCrawlDelay(userAgent?: string): number | undefined
} = require('robots-parser')

export const WIVWAV_CRAWLER_USER_AGENT = 'WivWav/1.0 (+https://wivwav.com/bot)'

export interface CrawledHtmlPage {
  url: string
  body: string
  $: CheerioCrawlingContext['$']
}

export type CrawledHtmlPageHandler = (page: CrawledHtmlPage) => void | Promise<void>

export interface CrawleeHtmlFetcher {
  crawl(urls: string[], handler: CrawledHtmlPageHandler): Promise<void>
  fetchOne(url: string): Promise<CrawledHtmlPage>
}

export interface RobotsDelayProbe {
  delaySeconds: number | null
  robotsUrl: string
}

type CheerioCrawlerConstructor = new (
  options?: CheerioCrawlerOptions,
  config?: Configuration,
) => { run(input?: Parameters<CheerioCrawler['run']>[0]): Promise<unknown> }

interface CrawleeHtmlFetcherConfig {
  createCrawler?: CheerioCrawlerConstructor
  fetchRobots?: typeof fetch
  maxConcurrency?: number
}

export class DefaultCrawleeHtmlFetcher implements CrawleeHtmlFetcher {
  private readonly createCrawler: CheerioCrawlerConstructor
  private readonly fetchRobots: typeof fetch
  private readonly maxConcurrency: number

  constructor(config: CrawleeHtmlFetcherConfig = {}) {
    this.createCrawler = config.createCrawler ?? CheerioCrawler
    this.fetchRobots = config.fetchRobots ?? fetch
    this.maxConcurrency = config.maxConcurrency ?? 1
  }

  async fetchOne(url: string): Promise<CrawledHtmlPage> {
    let page: CrawledHtmlPage | null = null
    await this.crawl([url], (crawledPage) => {
      page = crawledPage
    })
    if (!page) {
      throw new Error(`Crawlee did not return HTML for ${url}`)
    }
    return page
  }

  async crawl(urls: string[], handler: CrawledHtmlPageHandler): Promise<void> {
    if (urls.length === 0) return

    const delay = await this.readLargestCrawlDelay(urls)
    const crawler = new this.createCrawler(
      {
        maxConcurrency: this.maxConcurrency,
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60,
        navigationTimeoutSecs: 30,
        sameDomainDelaySecs: delay,
        respectRobotsTxtFile: { userAgent: WIVWAV_CRAWLER_USER_AGENT },
        preNavigationHooks: [
          (_context, gotOptions) => {
            gotOptions.headers = {
              ...gotOptions.headers,
              'user-agent': WIVWAV_CRAWLER_USER_AGENT,
            }
          },
        ],
        async requestHandler({ request, body, $ }) {
          await handler({
            url: request.loadedUrl ?? request.url,
            body: typeof body === 'string' ? body : body.toString(),
            $,
          })
        },
      },
      new Configuration({ persistStorage: false }),
    )

    await crawler.run(
      urls.map((url) => ({
        url,
        headers: { 'user-agent': WIVWAV_CRAWLER_USER_AGENT },
      })),
    )
  }

  private async readLargestCrawlDelay(urls: string[]): Promise<number> {
    const uniqueOrigins = Array.from(new Set(urls.map((url) => new URL(url).origin)))
    const delays = await Promise.all(
      uniqueOrigins.map(async (origin) => {
        const result = await readRobotsCrawlDelay(`${origin}/robots.txt`, this.fetchRobots)
        return result.delaySeconds
      }),
    )
    return delays.reduce<number>((max, delay) => Math.max(max, delay ?? 0), 0)
  }
}

export async function readRobotsCrawlDelay(
  robotsUrl: string,
  fetchRobots: typeof fetch = fetch,
): Promise<RobotsDelayProbe> {
  try {
    const response = await fetchRobots(robotsUrl, {
      headers: { 'user-agent': WIVWAV_CRAWLER_USER_AGENT },
    })
    if (!response.ok) return { delaySeconds: null, robotsUrl }

    const text = await response.text()
    const robots = robotsParser(robotsUrl, text)
    return {
      delaySeconds: robots.getCrawlDelay(WIVWAV_CRAWLER_USER_AGENT) ?? null,
      robotsUrl,
    }
  } catch (err) {
    crawleeLog.warning(`Failed to read robots crawl-delay for ${robotsUrl}`, { error: err })
    return { delaySeconds: null, robotsUrl }
  }
}
