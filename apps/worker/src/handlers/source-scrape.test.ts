import { describe, expect, it, vi } from 'vitest'
import { createNoopLogger } from '@wivwav/logger'

const createSourceAdapter = vi.fn((_hash: string | null, _config: unknown) => ({ name: 'fake' }))

vi.mock('@wivwav/types', () => ({
  findScraperSourceByName: (name: string) => ({ key: name === 'eBay Motors' ? 'ebay-motors' : 'blvd' }),
}))
vi.mock('@wivwav/scraper-sources', () => ({
  report: vi.fn(async () => undefined),
  SOURCE_ADAPTER_MODULES: {
    blvd: { createSourceAdapter },
    'ebay-motors': { createSourceAdapter },
  },
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

function build(overrides: Record<string, unknown> = {}) {
  const gateway = {
    getExecutionState: vi.fn(async () => ({ state: { status: 'active', errorMessage: null } })),
    getSourceProfile: vi.fn(async () => ({ name: 'BLVD.com', fingerprintHash: 'h', page1Hash: null })),
    getEbayMotorsCredentials: vi.fn(async () => ({ appId: 'app', certId: 'cert', environment: 'sandbox' })),
    ...overrides,
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

describe('source-scrape execution-state preflight (#1212)', () => {
  it.each(['disabled', 'paused'])('skips an eBay source when it is %s before loading credentials', async (status) => {
    createSourceAdapter.mockClear()
    const gateway = {
      getExecutionState: vi.fn(async () => ({ state: { status, errorMessage: null } })),
      getSourceProfile: vi.fn(async () => ({ name: 'eBay Motors', fingerprintHash: 'h', page1Hash: null })),
      getEbayMotorsCredentials: vi.fn(),
    }

    const result = await build(gateway)({ sourceId: 'ebay' }, 'c1')

    expect(result).toEqual({ listingsChanged: false })
    expect(gateway.getEbayMotorsCredentials).not.toHaveBeenCalled()
    expect(gateway.getSourceProfile).toHaveBeenCalledTimes(1)
    expect(createSourceAdapter).not.toHaveBeenCalled()
  })

  it('still loads credentials for an active eBay source', async () => {
    createSourceAdapter.mockClear()
    const gateway = {
      getExecutionState: vi.fn(async () => ({ state: { status: 'active', errorMessage: null } })),
      getSourceProfile: vi.fn(async () => ({ name: 'eBay Motors', fingerprintHash: 'h', page1Hash: null })),
      getEbayMotorsCredentials: vi.fn(async () => ({ appId: 'app', certId: 'cert', environment: 'sandbox' })),
    }

    await build(gateway)({ sourceId: 'ebay' }, 'c1')

    expect(gateway.getEbayMotorsCredentials).toHaveBeenCalledTimes(1)
    expect(createSourceAdapter.mock.calls[0]?.[1]).toMatchObject({
      ebayCredentials: { appId: 'app', certId: 'cert', environment: 'sandbox' },
    })
  })
})
