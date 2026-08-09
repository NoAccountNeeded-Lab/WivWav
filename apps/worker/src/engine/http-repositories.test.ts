import { describe, expect, it, vi } from 'vitest'
import { HttpListingRepository, HttpScraperRunRepository, RunContext } from './http-repositories.js'
import type { ScraperGatewayClient } from '../scraper-gateway-client.js'

function fakeGateway(overrides: Partial<ScraperGatewayClient> = {}): ScraperGatewayClient {
  return {
    startRun: vi.fn(async () => ({ id: 'run-1' })),
    markGone: vi.fn(async () => ({ goneCount: 3 })),
    upsertListing: vi.fn(async () => ({ listingId: 'l1', outcome: 'created', changedFields: [] })),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('RunContext threading', () => {
  it('markGone throws if called before a run was started', async () => {
    const runContext = new RunContext()
    const gateway = fakeGateway()
    const listings = new HttpListingRepository(gateway, runContext)
    await expect(listings.markGone('s1', [], { isCompleteCrawl: true })).rejects.toThrow(
      /before a run was started/,
    )
  })

  it('threads the started run id into markGone', async () => {
    const runContext = new RunContext()
    const gateway = fakeGateway()
    const runs = new HttpScraperRunRepository(gateway, runContext)
    const listings = new HttpListingRepository(gateway, runContext)

    await runs.start('s1')
    const count = await listings.markGone('s1', ['k1'], { isCompleteCrawl: true })

    expect(gateway.markGone).toHaveBeenCalledWith('s1', {
      scraperRunId: 'run-1',
      activeSourceRecordKeys: ['k1'],
      isCompleteCrawl: true,
    })
    expect(count).toBe(3)
  })

  it('threads the started run id into listing upserts', async () => {
    const runContext = new RunContext()
    const gateway = fakeGateway()
    const runs = new HttpScraperRunRepository(gateway, runContext)
    const listings = new HttpListingRepository(gateway, runContext)

    await runs.start('s1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await listings.upsert({ sourceId: 's1' } as any)

    expect(gateway.upsertListing).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }))
  })
})
