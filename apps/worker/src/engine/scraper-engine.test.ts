import { describe, expect, it, vi } from 'vitest'
import { EscalateCapabilitySignal } from '@wivwav/scraper-sources'
import type { SourceAdapter } from '@wivwav/scraper-sources'
import { ScraperEngine } from './scraper-engine.js'

function buildEngine(adapterOverrides: Partial<SourceAdapter>) {
  const runs = {
    start: vi.fn(async () => ({ id: 'run-1' })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  }
  const sources = {
    getExecutionState: vi.fn(async () => ({ status: 'active' as const, errorMessage: null })),
    markNeedsRemapping: vi.fn(async () => {}),
    markActive: vi.fn(async () => {}),
    markChecked: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    markPaused: vi.fn(async () => {}),
    getMappings: vi.fn(async () => []),
    setMappings: vi.fn(async () => {}),
    getLastFullCrawlAt: vi.fn(async () => null),
    getDriftBaseline: vi.fn(async () => null),
    setDriftBaseline: vi.fn(async () => {}),
  }
  const listings = {
    upsert: vi.fn(async () => ({ outcome: 'created' as const })),
    markGone: vi.fn(async () => 0),
  }
  const adapter = {
    sourceId: 'blvd',
    name: 'BLVD.com',
    checkPage1: vi.fn(async () => ({ changed: true, currentHash: 'p1' })),
    checkStructure: vi.fn(async () => ({ changed: false, currentHash: 'h', previousHash: 'h' })),
    scrape: vi.fn(async () => ({ listings: [] })),
    ...adapterOverrides,
  } as unknown as SourceAdapter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new ScraperEngine({ runs, sources, listings } as any)
  engine.register(adapter, 'src-1')
  return { engine, runs, sources, listings }
}

describe('ScraperEngine capability escalation (#1043)', () => {
  it.each(['checkPage1', 'scrape'] as const)(
    'rethrows an escalation from %s without erroring the source or recording a completed scrape',
    async (stage) => {
      const signal = new EscalateCapabilitySignal('chromium', 'blocked over http')
      const { engine, runs, sources, listings } = buildEngine({
        [stage]: vi.fn(async () => {
          throw signal
        }),
      })

      await expect(engine.runSource('src-1')).rejects.toBe(signal)

      expect(sources.markError).not.toHaveBeenCalled()
      expect(sources.markPaused).not.toHaveBeenCalled()
      expect(sources.markNeedsRemapping).not.toHaveBeenCalled()
      expect(sources.markActive).not.toHaveBeenCalled()
      expect(sources.markChecked).not.toHaveBeenCalled()
      expect(sources.setDriftBaseline).not.toHaveBeenCalled()
      expect(runs.complete).not.toHaveBeenCalled()
      expect(listings.upsert).not.toHaveBeenCalled()
      expect(listings.markGone).not.toHaveBeenCalled()
      // The attempt's run row is closed (never left open) and says why.
      expect(runs.fail).toHaveBeenCalledTimes(1)
      expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('Escalated to chromium'))
    },
  )

  it('still marks the source errored for an ordinary scrape failure', async () => {
    const { engine, sources } = buildEngine({
      scrape: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(engine.runSource('src-1')).rejects.toThrow('boom')
    expect(sources.markError).toHaveBeenCalledWith('src-1', 'boom')
  })
})
