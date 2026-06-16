import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WivWavLogger } from '@wivwav/logger'

// ── Module mocks ──────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top — cannot reference outer `vi.fn()` variables.
// Store the mock on a module-level object so beforeEach can reset it.

const chromiumMocks = {
  pageGoto: vi.fn(),
  pageUrl: vi.fn(),
  pageContent: vi.fn(),
  pageClose: vi.fn(),
  browserNewPage: vi.fn(),
  browserClose: vi.fn(),
}

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

vi.mock('@playwright/test', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      get newPage() { return chromiumMocks.browserNewPage },
      get close() { return chromiumMocks.browserClose },
    }),
  },
}))

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

function setupPage(opts: { status?: number; url?: string } = {}) {
  const page = {
    goto: vi.fn().mockResolvedValue({ status: () => opts.status ?? 200 }),
    url: vi.fn().mockReturnValue(opts.url ?? 'https://example.com/listing/1'),
    content: vi.fn().mockResolvedValue('<html></html>'),
    close: vi.fn().mockResolvedValue(undefined),
  }
  chromiumMocks.browserNewPage.mockResolvedValue(page)
  chromiumMocks.browserClose.mockResolvedValue(undefined)
  return page
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runDetailCrawlJob – listing-sync enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    setupPage({ status: 404 })

    const listingSyncQueue = new MockQueueAdapter('listing-sync')

    await runDetailCrawlJob('src-1', undefined, listingSyncQueue)

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
    setupPage({ status: 404 })

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
    setupPage({ status: 404 })

    // No listingSyncQueue — must not throw
    await expect(runDetailCrawlJob('src-1')).resolves.toBeUndefined()
  })
})
