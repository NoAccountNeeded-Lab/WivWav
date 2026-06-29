import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WivWavLogger } from '@wivwav/logger'
import { MockBrowserService } from '../browser/index.js'
import type { MockPageRecord } from '../browser/index.js'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { MockQueueAdapter, CRITICAL_JOB_OPTIONS } from '@wivwav/queue'
import { runDetailCrawlJob } from './detail-crawl.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeBrowserService(pages: Map<string, MockPageRecord> = new Map()) {
  return new MockBrowserService(pages)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runDetailCrawlJob – listing-sync enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a missing source id before querying the database', async () => {
    await expect(runDetailCrawlJob(undefined as never)).rejects.toThrow(
      '[detail-crawl] sourceId must be a non-empty string',
    )
    expect(getDb).not.toHaveBeenCalled()
  })

  it('passes CRITICAL_JOB_OPTIONS when enqueuing a listing-sync job after a 404', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/1', status: 'active' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/listing/1', { url: 'https://example.com/listing/1', html: '', statusCode: 404 }],
    ])
    const browser = makeBrowserService(pages)
    const listingSyncQueue = new MockQueueAdapter('listing-sync')

    await runDetailCrawlJob('src-1', undefined, listingSyncQueue, browser)

    const enqueued = listingSyncQueue.getEnqueued()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]?.options).toEqual(CRITICAL_JOB_OPTIONS)
  })

  it('does not throw when listing-sync queue.add() rejects — logs the error instead', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/1', status: 'active' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/listing/1', { url: 'https://example.com/listing/1', html: '', statusCode: 404 }],
    ])
    const browser = makeBrowserService(pages)

    const failingQueue = new MockQueueAdapter('listing-sync')
    vi.spyOn(failingQueue, 'add').mockRejectedValue(new Error('queue unavailable'))

    const errorArgs: unknown[][] = []
    const mockLogger: WivWavLogger = {
      debug: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      warn: (..._args: unknown[]) => {},
      error: (...args: unknown[]) => void errorArgs.push(args),
      level: 'info',
      child: () => mockLogger,
    }

    await expect(
      runDetailCrawlJob(
        'src-1',
        { logger: mockLogger, log: async () => {}, updateProgress: async () => {} },
        failingQueue,
        browser,
      ),
    ).resolves.toBeUndefined()

    // logger.error was called with (ctx, msg) — second argument is the message
    expect(errorArgs.some(args => args[1] === '[detail-crawl] Failed to enqueue listing-sync job')).toBe(true)
  })

  it('skips the listing-sync enqueue when no queue is provided', async () => {
    const db = makeDb({
      listing: {
        findMany: vi.fn().mockResolvedValue([
          { sourceUrl: 'https://example.com/listing/1', status: 'active' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    const pages = new Map<string, MockPageRecord>([
      ['https://example.com/listing/1', { url: 'https://example.com/listing/1', html: '', statusCode: 404 }],
    ])
    const browser = makeBrowserService(pages)

    // No listingSyncQueue — must not throw
    await expect(runDetailCrawlJob('src-1', undefined, undefined, browser)).resolves.toBeUndefined()
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

    await runDetailCrawlJob('src-1', undefined, undefined, browser)

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
    await runDetailCrawlJob('src-1', undefined, undefined, browser)

    const [session] = browser.sessions
    expect(session?.closed).toBe(true)
  })
})
