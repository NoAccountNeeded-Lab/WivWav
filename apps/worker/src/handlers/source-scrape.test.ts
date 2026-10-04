import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'

const createSourceAdapter = vi.fn((_hash: string | null, _config: unknown) => ({ name: 'fake' }))

vi.mock('@wivwav/types', () => ({
  findScraperSourceByName: () => ({ key: 'blvd' }),
}))
vi.mock('@wivwav/scraper-sources', () => ({
  SOURCE_ADAPTER_MODULES: { blvd: { createSourceAdapter } },
}))
vi.mock('../engine/scraper-engine.js', () => ({
  ScraperEngine: class {
    register(): void {}
    async runSource(): Promise<boolean> {
      return false
    }
  },
}))
vi.mock('../engine/http-repositories.js', () => ({
  HttpListingRepository: class {},
  HttpScraperRunRepository: class {},
  HttpSourceRepository: class {},
  RunContext: class {},
}))

const { createSourceScrapeHandler } = await import('./source-scrape.js')

function build() {
  const gateway = {
    getSourceProfile: vi.fn(async () => ({ name: 'BLVD.com', fingerprintHash: 'h', page1Hash: null })),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createSourceScrapeHandler(gateway as any, undefined, createNoopLogger())
}

describe('source-scrape handler escalation wiring (#1043)', () => {
  it('lets a first-run job escalate', async () => {
    createSourceAdapter.mockClear()
    await build()({ sourceId: 's1' }, 'c1')
    expect(createSourceAdapter.mock.calls[0]?.[1]).toMatchObject({ allowCapabilityEscalation: true })
  })

  it('forbids a further escalation once the payload records one', async () => {
    createSourceAdapter.mockClear()
    await build()(
      { sourceId: 's1', capabilityEscalation: { capability: 'chromium', reason: 'x', at: 1 } },
      'c1',
    )
    expect(createSourceAdapter.mock.calls[0]?.[1]).toMatchObject({ allowCapabilityEscalation: false })
  })
})
