import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockBrowserService } from '../browser/index.js'
import type { MockPageRecord } from '../browser/index.js'
import type * as WivwavDbModule from '@wivwav/db'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@wivwav/db', async () => {
  const actual = await vi.importActual<typeof WivwavDbModule>('@wivwav/db')
  return { ...actual, getDb: vi.fn() }
})

import { getDb } from '@wivwav/db'
import { runDetailCrawlJob } from './detail-crawl.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      findUnique: vi.fn().mockResolvedValue({ status: 'active', errorMessage: null }),
    },
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

function makeBrowserService(pages: Map<string, MockPageRecord> = new Map()) {
  return new MockBrowserService(pages)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

  it('marks a listing gone after a 404, without touching the search index directly', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'listing-1', sourceUrl: 'https://example.com/listing/1', status: 'active' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/listing/1', { url: 'https://example.com/listing/1', html: '', statusCode: 404 }],
    ])
    const browser = makeBrowserService(pages)

    await runDetailCrawlJob('src-1', undefined, browser)

    // Search-index sync is the single-owner indexer poller's concern (#669) —
    // this job only needs to have committed the status change to Postgres.
    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['listing-1'] } },
      data: { status: 'gone', goneAt: expect.any(Date) },
    })
  })

  it('upserts raw page HTML for a successful 200 crawl', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/2', status: 'active' },
        ]),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/listing/2', { url: 'https://example.com/listing/2', html: '<html>van</html>', statusCode: 200 }],
    ])
    const browser = makeBrowserService(pages)

    await runDetailCrawlJob('src-1', undefined, browser)

    expect(db.rawPage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { url: 'https://example.com/listing/2' },
        create: expect.objectContaining({ html: '<html>van</html>' }),
      }),
    )
  })

  it('closes the browser session when all pages are processed', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/3', status: 'active' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const browser = makeBrowserService()
    await runDetailCrawlJob('src-1', undefined, browser)

    const [session] = browser.sessions
    expect(session?.closed).toBe(true)
  })

  it('skips stale queued work when the source is disabled', async () => {
    const db = makeDb({
      source: {
        findUnique: vi.fn().mockResolvedValue({ status: 'disabled', errorMessage: 'Operator rollback' }),
      },
      listing: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runDetailCrawlJob('src-1')

    expect(db.listing.findMany).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalledOnce()
  })
})
