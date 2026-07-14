import type { Configuration, PlaywrightCrawlerOptions } from '@crawlee/playwright'
import { describe, expect, it, vi } from 'vitest'
import {
  createDetailCrawlerOptions,
  createNavigationRateLimiter,
  fetchDetailPagesWithCrawlee,
  type DetailCrawlerFactory,
  type DetailFetchHandlers,
} from './detail-fetcher.js'

function makeHandlers(): DetailFetchHandlers {
  return {
    onFetched: vi.fn().mockResolvedValue(undefined),
    onFailed: vi.fn().mockResolvedValue(undefined),
  }
}

function requireHandler<T>(handler: T | undefined, name: string): T {
  if (handler === undefined) throw new Error(`${name} is required`)
  return handler
}

describe('createDetailCrawlerOptions', () => {
  it('keeps requests sequential with Crawlee politeness caps', () => {
    const options = createDetailCrawlerOptions(makeHandlers())

    expect(options).toMatchObject({
      minConcurrency: 1,
      maxConcurrency: 1,
      sameDomainDelaySecs: 2,
      maxRequestsPerMinute: 30,
    })
  })

  it('enables bounded automatic retries for failed requests', () => {
    const options = createDetailCrawlerOptions(makeHandlers())

    expect(options.maxRequestRetries).toBe(2)
  })

  it('forwards fetched page data to the success handler', async () => {
    const handlers = makeHandlers()
    const options = createDetailCrawlerOptions(handlers)
    const requestHandler = requireHandler(options.requestHandler, 'requestHandler')

    await requestHandler({
      request: { url: 'https://example.com/listing/1' },
      page: {
        url: () => 'https://example.com/listing/1?loaded=true',
        content: vi.fn().mockResolvedValue('<html>van</html>'),
      },
      response: { status: () => 200 },
    } as never)

    expect(handlers.onFetched).toHaveBeenCalledWith({
      sourceUrl: 'https://example.com/listing/1',
      finalUrl: 'https://example.com/listing/1?loaded=true',
      statusCode: 200,
      html: '<html>van</html>',
    })
  })

  it('forwards the final request error to the failure handler', async () => {
    const handlers = makeHandlers()
    const options = createDetailCrawlerOptions(handlers)
    const failedRequestHandler = requireHandler(
      options.failedRequestHandler,
      'failedRequestHandler',
    )
    const error = new Error('navigation timed out')

    await failedRequestHandler(
      { request: { url: 'https://example.com/listing/failed' } } as never,
      error,
    )

    expect(handlers.onFailed).toHaveBeenCalledWith({
      sourceUrl: 'https://example.com/listing/failed',
      error,
    })
  })
})

describe('createNavigationRateLimiter', () => {
  it('waits out the remainder of a two-second global request gap', async () => {
    let now = 10_000
    const sleep = vi.fn(async (milliseconds: number) => {
      now += milliseconds
    })
    const limitNavigation = createNavigationRateLimiter(2_000, {
      now: () => now,
      sleep,
    })

    await limitNavigation()
    now += 750
    await limitNavigation()

    expect(sleep).toHaveBeenCalledWith(1_250)
  })
})

describe('fetchDetailPagesWithCrawlee', () => {
  it('runs the exact provided URLs with non-persistent storage', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    let capturedOptions: PlaywrightCrawlerOptions | undefined
    let capturedConfiguration: Configuration | undefined
    const createCrawler: DetailCrawlerFactory = (options, configuration) => {
      capturedOptions = options
      capturedConfiguration = configuration
      return { run }
    }
    const urls = [
      'https://example.com/listing/1',
      'https://example.com/listing/2',
    ]

    await fetchDetailPagesWithCrawlee(urls, makeHandlers(), createCrawler)

    expect({
      urls: run.mock.calls[0]?.[0],
      persistStorage: capturedConfiguration?.get('persistStorage'),
      purgeOnStart: capturedConfiguration?.get('purgeOnStart'),
      hasRequestHandler: capturedOptions?.requestHandler !== undefined,
    }).toEqual({
      urls,
      persistStorage: false,
      purgeOnStart: false,
      hasRequestHandler: true,
    })
  })
})
