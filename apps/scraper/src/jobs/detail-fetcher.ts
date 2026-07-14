import {
  Configuration,
  PlaywrightCrawler,
  type PlaywrightCrawlerOptions,
  type RequestOptions,
} from '@crawlee/playwright'

const RATE_LIMIT_SECONDS = 2
const RATE_LIMIT_SAFETY_MILLISECONDS = 100
const MAX_REQUESTS_PER_MINUTE = 30
const MAX_REQUEST_RETRIES = 2
const NAVIGATION_TIMEOUT_SECONDS = 45

export interface RateLimitClock {
  now(): number
  sleep(milliseconds: number): Promise<void>
}

export interface FetchedDetailPage {
  sourceUrl: string
  finalUrl: string
  statusCode: number | null
  html: string
}

export interface FailedDetailPage {
  sourceUrl: string
  error: Error
}

export interface DetailFetchHandlers {
  onFetched(page: FetchedDetailPage): Promise<void>
  onFailed(page: FailedDetailPage): Promise<void>
}

interface DetailCrawlerRunner {
  run(requests: RequestOptions[]): Promise<unknown>
}

export type DetailCrawlerFactory = (
  options: PlaywrightCrawlerOptions,
  configuration: Configuration,
) => DetailCrawlerRunner

export type DetailPageFetcher = (
  urls: string[],
  handlers: DetailFetchHandlers,
) => Promise<void>

function createDefaultCrawler(
  options: PlaywrightCrawlerOptions,
  configuration: Configuration,
): DetailCrawlerRunner {
  return new PlaywrightCrawler(options, configuration)
}

const systemClock: RateLimitClock = {
  now: Date.now,
  sleep(milliseconds): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  },
}

export function createNavigationRateLimiter(
  delayMilliseconds: number,
  clock: RateLimitClock = systemClock,
): () => Promise<void> {
  let nextNavigationAt = 0

  return async (): Promise<void> => {
    const remainingDelay = nextNavigationAt - clock.now()
    if (remainingDelay > 0) await clock.sleep(remainingDelay)
    nextNavigationAt = clock.now() + delayMilliseconds
  }
}

export function createDetailCrawlerOptions(
  handlers: DetailFetchHandlers,
): PlaywrightCrawlerOptions {
  const waitForRateLimit = createNavigationRateLimiter(
    RATE_LIMIT_SECONDS * 1000 + RATE_LIMIT_SAFETY_MILLISECONDS,
  )

  return {
    // Preserve the former job's one-at-a-time behavior. The domain delay is
    // the primary politeness control; the per-minute cap is a second guard.
    minConcurrency: 1,
    maxConcurrency: 1,
    sameDomainDelaySecs: RATE_LIMIT_SECONDS,
    maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
    maxRequestRetries: MAX_REQUEST_RETRIES,
    navigationTimeoutSecs: NAVIGATION_TIMEOUT_SECONDS,
    useSessionPool: false,
    launchContext: {
      launchOptions: { chromiumSandbox: true },
    },
    preNavigationHooks: [
      async (_context, gotoOptions): Promise<void> => {
        // Crawlee's domain delay is advisory and can begin the next request
        // early on a fast handler. Enforce the former global two-second gap,
        // plus a small scheduling margin, immediately before every navigation
        // (including retry attempts).
        await waitForRateLimit()
        if (gotoOptions === undefined) return
        gotoOptions.waitUntil = 'networkidle'
        gotoOptions.timeout = NAVIGATION_TIMEOUT_SECONDS * 1000
      },
    ],
    async requestHandler({ page, request, response }): Promise<void> {
      await handlers.onFetched({
        sourceUrl: request.url,
        finalUrl: page.url(),
        statusCode: response?.status() ?? null,
        html: await page.content(),
      })
    },
    async failedRequestHandler({ request }, error): Promise<void> {
      await handlers.onFailed({ sourceUrl: request.url, error })
    },
  }
}

export async function fetchDetailPagesWithCrawlee(
  urls: string[],
  handlers: DetailFetchHandlers,
  createCrawler: DetailCrawlerFactory = createDefaultCrawler,
): Promise<void> {
  // Crawlee's implicit RequestQueue is useful for retries, but detail-crawl's
  // durable URL policy remains in Postgres. Keep the queue process-local and
  // prevent the default ./storage directory from being created.
  const configuration = new Configuration({
    persistStorage: false,
    purgeOnStart: false,
  })
  const crawler = createCrawler(createDetailCrawlerOptions(handlers), configuration)
  await crawler.run(
    urls.map((url, index) => ({
      url,
      // RequestQueue deduplicates by URL by default. The former loop fetched
      // every selected row, so keep repeated URLs behaviorally equivalent.
      uniqueKey: `detail-crawl:${index}:${url}`,
    })),
  )
}
