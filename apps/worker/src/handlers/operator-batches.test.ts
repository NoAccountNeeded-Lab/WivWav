import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'
import { createDetailCrawlHandler } from './detail-crawl.js'
import { createDetailExtractHandler } from './detail-extract.js'

describe('operator batch settings', () => {
  it('uses the live crawl batch size from the gateway', async () => {
    const gateway = {
      getExecutionState: vi.fn(async () => ({ state: null })),
      getOperatorSetting: vi.fn(async (key: string) => key === 'detail_crawl.batch_size' ? 400 : 1500),
      getDetailCrawlPendingListings: vi.fn(async () => ({ listings: [] })),
    }
    await createDetailCrawlHandler(gateway as never, {} as never, createNoopLogger())({ sourceId: 'source-1' }, 'run-1')
    expect(gateway.getDetailCrawlPendingListings).toHaveBeenCalledWith('source-1', 400, undefined)
  })

  it('claims one listing and releases its lock token for a listingId payload', async () => {
    const page = {
      goto: vi.fn(async () => ({ status: () => 200 })),
      url: () => 'https://dealer.example/a',
      content: async () => '<html></html>',
      close: vi.fn(async () => undefined),
    }
    const gateway = {
      getExecutionState: vi.fn(async () => ({ state: null })),
      getOperatorSetting: vi.fn(async () => 400),
      getDetailCrawlPendingListings: vi.fn(async () => ({
        listings: [{ sourceUrl: 'https://dealer.example/a', status: 'active' }],
        lockedAt: '2026-10-27T00:00:00.000Z',
      })),
      upsertRawPage: vi.fn(async () => ({})),
      releaseDetailCrawlLock: vi.fn(async () => ({ ok: true })),
    }
    const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) }
    const browserService = { launch: vi.fn(async () => browser) }
    await createDetailCrawlHandler(gateway as never, browserService as never, createNoopLogger())(
      { sourceId: 'source-1', listingId: 'l1' },
      'run-1',
    )
    expect(gateway.getDetailCrawlPendingListings).toHaveBeenCalledWith('source-1', 400, 'l1')
    expect(gateway.releaseDetailCrawlLock).toHaveBeenCalledWith('l1', '2026-10-27T00:00:00.000Z')
  })

  it('uses the live extract batch size from the gateway', async () => {
    const gateway = {
      getExecutionState: vi.fn(async () => ({ state: null })),
      getOperatorSetting: vi.fn(async () => 350),
      getDetailExtractPendingRawPages: vi.fn(async () => ({ rawPages: [] })),
    }
    await createDetailExtractHandler(gateway as never, {} as never, createNoopLogger())({ sourceId: 'source-1' }, 'run-1')
    expect(gateway.getDetailExtractPendingRawPages).toHaveBeenCalledWith('source-1', 350)
  })
})
