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
    expect(gateway.getDetailCrawlPendingListings).toHaveBeenCalledWith('source-1', 400)
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
