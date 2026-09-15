import { describe, expect, it, vi } from 'vitest'
import type { CheerioCrawlerOptions } from 'crawlee'
import {
  DefaultCrawleeHtmlFetcher,
  WIVWAV_CRAWLER_USER_AGENT,
  readRobotsCrawlDelay,
} from './html-fetcher.js'

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

describe('readRobotsCrawlDelay', () => {
  it('reads crawl-delay for the WivWav user-agent from robots.txt', async () => {
    const fetchRobots = vi.fn(async () =>
      htmlResponse(`User-agent: WivWav\nCrawl-delay: 10\nAllow: /\n`),
    )

    const result = await readRobotsCrawlDelay('https://www.mobilityworks.com/robots.txt', fetchRobots)

    expect(result).toEqual({
      delaySeconds: 10,
      robotsUrl: 'https://www.mobilityworks.com/robots.txt',
    })
    expect(fetchRobots).toHaveBeenCalledWith('https://www.mobilityworks.com/robots.txt', {
      headers: { 'user-agent': WIVWAV_CRAWLER_USER_AGENT },
    })
  })
})

describe('DefaultCrawleeHtmlFetcher', () => {
  it('passes robots crawl-delay into Crawlee same-domain request pacing', async () => {
    let capturedOptions: CheerioCrawlerOptions = {}
    let runInput: unknown = null
    class FakeCrawler {
      constructor(options?: CheerioCrawlerOptions) {
        capturedOptions = options ?? {}
      }

      async run(input?: unknown): Promise<void> {
        runInput = input
      }
    }

    const fetchRobots = vi.fn(async () =>
      htmlResponse(`User-agent: WivWav\nCrawl-delay: 10\nAllow: /\n`),
    )
    const fetcher = new DefaultCrawleeHtmlFetcher({
      createCrawler: FakeCrawler,
      fetchRobots,
    })

    await fetcher.crawl(['https://www.mobilityworks.com/wheelchair-vans-for-sale/'], () => {})

    expect(capturedOptions.respectRobotsTxtFile).toEqual({
      userAgent: WIVWAV_CRAWLER_USER_AGENT,
    })
    expect(capturedOptions.sameDomainDelaySecs).toBe(10)
    expect(runInput).toEqual([
      {
        url: 'https://www.mobilityworks.com/wheelchair-vans-for-sale/',
        headers: { 'user-agent': WIVWAV_CRAWLER_USER_AGENT },
      },
    ])
  })
})
