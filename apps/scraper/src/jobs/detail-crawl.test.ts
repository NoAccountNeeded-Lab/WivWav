import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DetailFetchHandlers,
  DetailPageFetcher,
  FetchedDetailPage,
} from './detail-fetcher.js'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runDetailCrawlJob } from './detail-crawl.js'

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    rawPage: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeFetchedPage(
  sourceUrl: string,
  overrides: Partial<FetchedDetailPage> = {},
): FetchedDetailPage {
  return {
    sourceUrl,
    finalUrl: sourceUrl,
    statusCode: 200,
    html: '<html>van</html>',
    ...overrides,
  }
}

function makeFetcher(
  run: (urls: string[], handlers: DetailFetchHandlers) => Promise<void>,
): DetailPageFetcher {
  return vi.fn(run)
}

describe('runDetailCrawlJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a missing source id before querying the database', async () => {
    await expect(runDetailCrawlJob(undefined as never)).rejects.toThrow(
      '[detail-crawl] sourceId must be a non-empty string',
    )
    expect(getDb).not.toHaveBeenCalled()
  })

  it('passes the pending listing URLs to the fetching layer in database order', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/1' },
          { sourceUrl: 'https://example.com/listing/2' },
        ]),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    const fetcher = makeFetcher(async () => {})

    await runDetailCrawlJob('src-1', undefined, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      [
        'https://example.com/listing/1',
        'https://example.com/listing/2',
      ],
      expect.objectContaining({
        onFetched: expect.any(Function),
        onFailed: expect.any(Function),
      }),
    )
  })

  it('marks a listing gone after a 404', async () => {
    const sourceUrl = 'https://example.com/listing/1'
    const db = makeDb({
      listing: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ sourceUrl }])
          .mockResolvedValueOnce([{ id: 'listing-1' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    const fetcher = makeFetcher(async (_urls, handlers) => {
      await handlers.onFetched(makeFetchedPage(sourceUrl, { statusCode: 404 }))
    })

    await runDetailCrawlJob('src-1', undefined, fetcher)

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['listing-1'] } },
      data: { status: 'gone', goneAt: expect.any(Date) },
    })
  })

  it('upserts equivalent raw page HTML for a successful crawl', async () => {
    const sourceUrl = 'https://example.com/listing/2'
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([{ sourceUrl }]),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    const fetcher = makeFetcher(async (_urls, handlers) => {
      await handlers.onFetched(makeFetchedPage(sourceUrl))
    })

    await runDetailCrawlJob('src-1', undefined, fetcher)

    expect(db.rawPage.upsert).toHaveBeenCalledWith({
      where: { url: sourceUrl },
      update: {
        html: '<html>van</html>',
        scrapedAt: expect.any(Date),
        processedAt: null,
      },
      create: { url: sourceUrl, sourceId: 'src-1', html: '<html>van</html>' },
    })
  })

  it('reports a failed request and still persists later successful pages', async () => {
    const failedUrl = 'https://example.com/listing/failed'
    const successfulUrl = 'https://example.com/listing/success'
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: failedUrl },
          { sourceUrl: successfulUrl },
        ]),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    const log = vi.fn().mockResolvedValue(undefined)
    const fetcher = makeFetcher(async (_urls, handlers) => {
      await handlers.onFailed({ sourceUrl: failedUrl, error: new Error('timeout') })
      await handlers.onFetched(makeFetchedPage(successfulUrl))
    })

    await runDetailCrawlJob('src-1', { log, updateProgress: vi.fn() }, fetcher)

    expect(log).toHaveBeenCalledWith(
      `[detail-crawl] Failed ${failedUrl}: Error: timeout`,
    )
    expect(db.rawPage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { url: successfulUrl } }),
    )
  })

  it('disconnects the database after fetching completes', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/3' },
        ]),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runDetailCrawlJob('src-1', undefined, makeFetcher(async () => {}))

    expect(db.$disconnect).toHaveBeenCalledOnce()
  })
})
