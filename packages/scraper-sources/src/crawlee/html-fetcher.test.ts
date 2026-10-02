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

  it('configures ignoreHttpErrorStatusCodes: [503] so a 503 reaches requestHandler instead of failedRequestHandler', async () => {
    let capturedOptions: CheerioCrawlerOptions = {}
    class FakeCrawler {
      constructor(options?: CheerioCrawlerOptions) {
        capturedOptions = options ?? {}
      }

      async run(): Promise<void> {}
    }

    const fetchRobots = vi.fn(async () => htmlResponse('User-agent: WivWav\nAllow: /\n'))
    const fetcher = new DefaultCrawleeHtmlFetcher({ createCrawler: FakeCrawler, fetchRobots })

    await fetcher.crawl(['https://www.blvd.com/wheelchair-vans-for-sale'], () => {})

    expect(capturedOptions.ignoreHttpErrorStatusCodes).toEqual([503])
  })

  it('passes the response statusCode through to the handler (e.g. a 403 bot-block page)', async () => {
    class BlockedStatusCrawler {
      private readonly options: CheerioCrawlerOptions

      constructor(options?: CheerioCrawlerOptions) {
        this.options = options ?? {}
      }

      async run(): Promise<void> {
        const requestHandler = this.options.requestHandler
        if (!requestHandler) return
        const context = {
          request: { url: 'https://www.blvd.com/wheelchair-vans-for-sale', loadedUrl: undefined },
          response: { statusCode: 403 },
          body: '<html>Just a moment...</html>',
          $: (() => {}) as never,
          enqueueLinks: async () => {},
        } as unknown as Parameters<NonNullable<CheerioCrawlerOptions['requestHandler']>>[0]
        await requestHandler(context)
      }
    }

    const fetchRobots = vi.fn(async () => htmlResponse('User-agent: WivWav\nAllow: /\n'))
    const fetcher = new DefaultCrawleeHtmlFetcher({
      createCrawler: BlockedStatusCrawler,
      fetchRobots,
    })

    const handler = vi.fn()
    await fetcher.crawl(['https://www.blvd.com/wheelchair-vans-for-sale'], handler)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, body: '<html>Just a moment...</html>' }),
    )
  })

  it('throws when Crawlee exhausts retries for any request', async () => {
    class FailingCrawler {
      private readonly options: CheerioCrawlerOptions

      constructor(options?: CheerioCrawlerOptions) {
        this.options = options ?? {}
      }

      async run(): Promise<void> {
        const failedRequestHandler = this.options.failedRequestHandler
        if (!failedRequestHandler) return
        const context = {
          request: { url: 'https://www.mobilityworks.com/wheelchair-vans-for-sale/' },
        } as Parameters<NonNullable<CheerioCrawlerOptions['failedRequestHandler']>>[0]
        await failedRequestHandler(context, new Error('network failed'))
      }
    }

    const fetchRobots = vi.fn(async () => htmlResponse('User-agent: WivWav\nAllow: /\n'))
    const fetcher = new DefaultCrawleeHtmlFetcher({
      createCrawler: FailingCrawler,
      fetchRobots,
    })

    await expect(
      fetcher.crawl(['https://www.mobilityworks.com/wheelchair-vans-for-sale/'], () => {}),
    ).rejects.toThrow('Crawlee failed 1 request(s)')
  })

  it('throws when Crawlee skips a request because robots.txt disallows it', async () => {
    class RobotsSkippedCrawler {
      private readonly options: CheerioCrawlerOptions

      constructor(options?: CheerioCrawlerOptions) {
        this.options = options ?? {}
      }

      async run(): Promise<void> {
        const onSkippedRequest = this.options.onSkippedRequest
        if (!onSkippedRequest) return
        const context = {
          url: 'https://www.mobilityworks.com/wheelchair-vans-for-sale/',
          reason: 'robotsTxt',
        } satisfies Parameters<NonNullable<CheerioCrawlerOptions['onSkippedRequest']>>[0]
        await onSkippedRequest(context)
      }
    }

    const fetchRobots = vi.fn(async () => htmlResponse('User-agent: WivWav\nAllow: /\n'))
    const fetcher = new DefaultCrawleeHtmlFetcher({
      createCrawler: RobotsSkippedCrawler,
      fetchRobots,
    })

    await expect(
      fetcher.crawl(['https://www.mobilityworks.com/wheelchair-vans-for-sale/'], () => {}),
    ).rejects.toThrow('Crawlee skipped 1 robots-disallowed request(s)')
  })
})


describe('cross-fetch robots pacing', () => {
  it('preserves the crawl-delay across separate fetchOne calls', async () => {
    const times: number[] = []
    class FakeCrawler {
      constructor(private readonly options: CheerioCrawlerOptions = {}) {}
      async run(): Promise<void> {
        const context = {
          request: { url: 'https://www.blvd.com/listings' },
          response: { statusCode: 200 }, body: '<html></html>', $: (() => {}) as never,
          enqueueLinks: async () => {},
        } as unknown as Parameters<NonNullable<CheerioCrawlerOptions['requestHandler']>>[0]
        for (const hook of this.options.preNavigationHooks ?? []) await hook(context, {})
        times.push(Date.now())
        await this.options.requestHandler?.(context)
      }
    }
    const fetcher = new DefaultCrawleeHtmlFetcher({
      createCrawler: FakeCrawler,
      fetchRobots: async () => htmlResponse('User-agent: *\nCrawl-delay: 0.1\nAllow: /\n'),
    })
    await fetcher.fetchOne('https://www.blvd.com/listings')
    await fetcher.fetchOne('https://www.blvd.com/listings')
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(99)
  })
})
