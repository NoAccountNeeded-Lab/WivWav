import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScraperEngine } from './scraper-engine.js'
import type { ScraperRunRepository, SourceRepository, ListingRepository } from './repositories.js'
import type { SourceAdapter, ScrapeResult, StructureCheckResult, Page1CheckResult } from './source-adapter.js'
import type { StructureDetector } from '../ai/structure-detector.js'
import type { JobContext } from '@wivwav/queue'
import { runGeocodeJob } from '../jobs/geocode.js'

vi.mock('../jobs/geocode.js', () => ({
  runGeocodeJob: vi.fn().mockResolvedValue(undefined),
}))

function makeRuns(): ScraperRunRepository {
  return {
    start: vi.fn().mockResolvedValue({ id: 'run-1' }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
}

function makeSources(lastFullCrawlAt: Date | null = null): SourceRepository {
  return {
    markNeedsRemapping: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(undefined),
    markChecked: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn().mockResolvedValue(undefined),
    markPaused: vi.fn().mockResolvedValue(undefined),
    getMappings: vi.fn().mockResolvedValue([]),
    setMappings: vi.fn().mockResolvedValue(undefined),
    getLastFullCrawlAt: vi.fn().mockResolvedValue(lastFullCrawlAt),
    // Baseline starts at the fixture's own observed rate so existing tests (which were
    // written before source-drift detection existed) do not trip the drift gate.
    getDriftBaseline: vi.fn().mockResolvedValue({ baselineErrorRate: 1, baselineMissingRate: 1 }),
    setDriftBaseline: vi.fn().mockResolvedValue(undefined),
  }
}

function makeListings(): ListingRepository {
  return {
    upsert: vi.fn().mockResolvedValue({
      listingId: 'list-1',
      outcome: 'created',
      changedFields: ['make'],
    }),
    markGone: vi.fn().mockResolvedValue(0),
  }
}

function makeDetector(confidence = 0.9): StructureDetector {
  return {
    remapFields: vi.fn().mockResolvedValue({
      mappings: [{ targetField: 'make', selector: 'h1', attribute: null, transform: null }],
      confidence,
      notes: 'Selectors updated',
    }),
  } as unknown as StructureDetector
}

function makeContext(): JobContext {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  }
}

function makeAdapter(sourceId: string, overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  const unchanged: StructureCheckResult = { changed: false, currentHash: 'abc', previousHash: null }
  const emptyResult: ScrapeResult = { listings: [], fingerprintHash: 'abc' }
  return {
    sourceId,
    name: sourceId,
    checkStructure: vi.fn().mockResolvedValue(unchanged),
    scrape: vi.fn().mockResolvedValue(emptyResult),
    ...overrides,
  }
}

function makeAdapterWithPage1(sourceId: string, page1Changed: boolean, overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  const page1Result: Page1CheckResult = { currentHash: 'page1-hash', changed: page1Changed }
  return makeAdapter(sourceId, {
    checkPage1: vi.fn().mockResolvedValue(page1Result),
    ...overrides,
  })
}

const LISTING_FIXTURE = {
  sourceId: 'src-1', sourceUrl: 'http://x.com/1', buyerUrl: 'http://x.com/1', externalId: 'ext-1', sourceRecordKey: 'ext-1',
  make: 'Toyota', model: 'Sienna', year: 2022, trim: null, vin: null,
  condition: 'used' as const, sellerType: 'dealer' as const,
  priceCents: null, mileage: null, color: null, fuelType: null, transmission: null,
  wav: { conversionType: 'unknown' as const, conversionManufacturer: null, floorLoweringInches: null, rampType: 'unknown' as const, conversionStatus: 'unknown' as const, wavFeatures: [], wheelchairCapacity: null },
  location: { zip: null, city: null, state: null, lat: null, lng: null },
  dealer: { name: null, phone: null, website: null },
  images: [], description: null, listedAt: new Date(),
}

describe('ScraperEngine', () => {
  let runs: ScraperRunRepository
  let sources: SourceRepository
  let listings: ListingRepository

  beforeEach(() => {
    runs = makeRuns()
    sources = makeSources()
    listings = makeListings()
  })

  function build(opts?: { fullCrawlIntervalHours?: number }) {
    return new ScraperEngine({ runs, sources, listings, ...opts })
  }

  it('throws when no adapter is registered for the source', async () => {
    const engine = build()
    await expect(engine.runSource('unknown')).rejects.toThrow('No adapter registered for source: unknown')
  })

  it('completes a successful scrape with no listings', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1')
    engine.register(adapter, adapter.sourceId)

    const listingsChanged = await engine.runSource('src-1')

    expect(runs.start).toHaveBeenCalledWith('src-1')
    expect(runs.complete).toHaveBeenCalledWith('run-1', 0, { listingsNew: 0, listingsUpdated: 0 })
    expect(sources.markActive).toHaveBeenCalledWith('src-1', { listingCount: 0, fingerprintHash: 'abc', isCompleteCrawl: true })
    expect(listings.upsert).not.toHaveBeenCalled()
    expect(listingsChanged).toBe(false)
  })

  // ─── page 1 gatekeeper ───────────────────────────────────────────────────────

  it('skips full crawl when page 1 is unchanged and periodic interval has not elapsed', async () => {
    const recentFullCrawl = new Date(Date.now() - 1000) // 1 second ago
    sources = makeSources(recentFullCrawl)
    const engine = build({ fullCrawlIntervalHours: 24 })
    const context = makeContext()
    const adapter = makeAdapterWithPage1('src-1', false)
    engine.register(adapter, adapter.sourceId)

    const listingsChanged = await engine.runSource('src-1', context)

    expect(adapter.checkPage1).toHaveBeenCalled()
    expect(sources.getLastFullCrawlAt).toHaveBeenCalledWith('src-1')
    expect(adapter.checkStructure).not.toHaveBeenCalled()
    expect(listingsChanged).toBe(false)
    expect(adapter.scrape).not.toHaveBeenCalled()
    expect(runs.complete).toHaveBeenCalledWith('run-1', 0)
    expect(sources.markChecked).toHaveBeenCalledWith('src-1')
    expect(sources.markActive).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('Page 1 unchanged'))
    expect(context.updateProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'no_changes' }))
  })

  it('forces a full crawl when page 1 is unchanged but periodic interval is overdue (no prior crawl)', async () => {
    sources = makeSources(null) // never crawled completely
    const engine = build({ fullCrawlIntervalHours: 24 })
    const context = makeContext()
    const adapter = makeAdapterWithPage1('src-1', false)
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', context)

    expect(sources.getLastFullCrawlAt).toHaveBeenCalledWith('src-1')
    expect(adapter.checkStructure).toHaveBeenCalled()
    expect(adapter.scrape).toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('periodic full crawl is overdue'))
  })

  it('forces a full crawl when periodic interval has elapsed', async () => {
    const oldFullCrawl = new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
    sources = makeSources(oldFullCrawl)
    const engine = build({ fullCrawlIntervalHours: 24 })
    const context = makeContext()
    const adapter = makeAdapterWithPage1('src-1', false)
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', context)

    expect(adapter.checkStructure).toHaveBeenCalled()
    expect(adapter.scrape).toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('periodic full crawl is overdue'))
  })

  it('proceeds with full crawl when page 1 hash changes', async () => {
    const engine = build()
    const adapter = makeAdapterWithPage1('src-1', true)
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(adapter.checkPage1).toHaveBeenCalled()
    expect(adapter.checkStructure).toHaveBeenCalled()
    expect(adapter.scrape).toHaveBeenCalled()
    expect(sources.markActive).toHaveBeenCalledWith('src-1', expect.objectContaining({ page1Hash: 'page1-hash', isCompleteCrawl: true }))
  })

  it('proceeds with full crawl when adapter has no checkPage1 (backward compat)', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1')
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(adapter.checkStructure).toHaveBeenCalled()
    expect(adapter.scrape).toHaveBeenCalled()
    expect(sources.markActive).toHaveBeenCalledWith('src-1', { listingCount: 0, fingerprintHash: 'abc', isCompleteCrawl: true })
  })

  it('does not call getLastFullCrawlAt when adapter has no checkPage1', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1')
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(sources.getLastFullCrawlAt).not.toHaveBeenCalled()
  })

  // ─── markGone receives isCompleteCrawl ───────────────────────────────────────

  it('passes isCompleteCrawl: true to markGone on a full scrape run', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({ listings: [LISTING_FIXTURE], fingerprintHash: 'abc' }),
    })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(listings.markGone).toHaveBeenCalledWith('src-1', ['ext-1'], { isCompleteCrawl: true })
  })

  // ─── structure change: no sampleHtml ────────────────────────────────────────

  it('marks needs_remapping with structured message when structure changes and no sampleHtml is provided', async () => {
    const engine = build()
    const context = makeContext()
    const changed: StructureCheckResult = { changed: true, currentHash: 'new', previousHash: 'old' }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', context)

    expect(sources.markNeedsRemapping).toHaveBeenCalledWith('src-1', expect.stringContaining('no HTML sample captured'))
    expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('no HTML sample captured'))
    expect(adapter.scrape).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('no sample HTML was captured'))
    expect(context.updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'blocked',
      reason: 'structure_changed_no_sample_html',
    }))
  })

  it('marks needs_remapping with structured message when structure changes, sampleHtml is present, but detector is null (AI unavailable)', async () => {
    const engine = new ScraperEngine({ runs, sources, listings })
    const context = makeContext()
    const changed: StructureCheckResult = {
      changed: true, currentHash: 'new', previousHash: 'old', sampleHtml: '<html>updated</html>',
    }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', context, null)

    expect(sources.markNeedsRemapping).toHaveBeenCalledWith('src-1', expect.stringContaining('AI remapping unavailable'))
    expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('AI remapping unavailable'))
    expect(adapter.scrape).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(expect.stringContaining('AI remapping is unavailable'))
    expect(context.updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'blocked',
      reason: 'structure_changed_ai_unavailable',
    }))
  })

  // ─── structure change: with sampleHtml, high confidence ─────────────────────

  it('calls remapFields with sampleHtml and stores new mappings', async () => {
    const detector = makeDetector(0.9)
    const engine = new ScraperEngine({ runs, sources, listings })
    const changed: StructureCheckResult = {
      changed: true, currentHash: 'new', previousHash: 'old', sampleHtml: '<html>updated</html>',
    }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', undefined, detector)

    expect(detector.remapFields).toHaveBeenCalledWith({
      sourceName: 'src-1',
      previousMappings: [],
      sampleHtml: '<html>updated</html>',
    })
    expect(sources.setMappings).toHaveBeenCalledWith('src-1', expect.any(Array))
  })

  it('proceeds with scrape on high-confidence remap', async () => {
    const engine = build()
    const detector = makeDetector(0.9)
    const changed: StructureCheckResult = {
      changed: true, currentHash: 'new', previousHash: 'old', sampleHtml: '<html>',
    }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', undefined, detector)

    expect(adapter.scrape).toHaveBeenCalled()
    expect(sources.markNeedsRemapping).not.toHaveBeenCalled()
  })

  // ─── structure change: with sampleHtml, low confidence ──────────────────────

  it('marks error (not needs_remapping) and fails run on low-confidence remap so source retries automatically', async () => {
    const engine = build()
    const detector = makeDetector(0.4)
    const context = makeContext()
    const changed: StructureCheckResult = {
      changed: true, currentHash: 'new', previousHash: 'old', sampleHtml: '<html>',
    }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1', context, detector)

    // Low-confidence remap: use markError (retried automatically) not markNeedsRemapping (operator block)
    expect(sources.markNeedsRemapping).not.toHaveBeenCalled()
    expect(sources.markError).toHaveBeenCalledWith('src-1', expect.stringContaining('low-confidence'))
    expect(adapter.scrape).not.toHaveBeenCalled()
    expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('low-confidence'))
    // Error message includes AI notes and confidence score
    expect(sources.markError).toHaveBeenCalledWith('src-1', expect.stringContaining('Selectors updated'))
    expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('0.40'))
    expect(context.updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'blocked',
      reason: 'structure_changed_low_confidence_remap',
    }))
  })

  // ─── structure change: malformed remap (missing/undefined confidence) ───────

  it('marks needs_remapping without rethrowing when AI remapFields throws', async () => {
    const engine = build()
    const context = makeContext()
    // Simulate a malformed AI response: remapFields throws because confidence is missing
    const malformedDetector = {
      remapFields: vi.fn().mockRejectedValue(
        new Error("AI remap response missing/invalid fields — expected numeric 'confidence', array 'mappings', and string 'notes'; got: {\"mappings\":[]}")
      ),
    } as unknown as StructureDetector
    const changed: StructureCheckResult = {
      changed: true, currentHash: 'new', previousHash: 'old', sampleHtml: '<html>updated</html>',
    }
    const adapter = makeAdapter('src-1', { checkStructure: vi.fn().mockResolvedValue(changed) })
    engine.register(adapter, adapter.sourceId)

    // Should NOT rethrow — AI errors are caught and degraded to needs_remapping to
    // prevent BullMQ from retrying the job immediately and infinitely.
    await expect(engine.runSource('src-1', context, malformedDetector)).resolves.toBe(false)

    // Source is marked needs_remapping (not error) so BullMQ doesn't retry
    expect(sources.markNeedsRemapping).toHaveBeenCalledWith(
      'src-1',
      expect.stringContaining("AI remap response missing/invalid fields")
    )
    expect(runs.fail).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining("AI remap response missing/invalid fields")
    )
    // Scrape was never attempted
    expect(adapter.scrape).not.toHaveBeenCalled()
  })

  // ─── gone detection ─────────────────────────────────────────────────────────

  it('calls markGone with sourceRecordKeys after a successful run', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({ listings: [LISTING_FIXTURE], fingerprintHash: 'abc' }),
    })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(listings.markGone).toHaveBeenCalledWith('src-1', ['ext-1'], { isCompleteCrawl: true })
  })

  it('uses the registered DB source id when upserting adapter listings', async () => {
    const engine = build()
    const adapter = makeAdapter('adapter-source-key', {
      scrape: vi.fn().mockResolvedValue({ listings: [{ ...LISTING_FIXTURE, sourceId: 'adapter-source-key' }], fingerprintHash: 'abc' }),
    })
    engine.register(adapter, 'db-source-id')

    const listingsChanged = await engine.runSource('db-source-id')

    expect(listings.upsert).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'db-source-id' }))
    expect(listingsChanged).toBe(true)
  })

  it('reports no changed listings when every source observation is unchanged', async () => {
    vi.mocked(listings.upsert).mockResolvedValue({
      listingId: 'list-1',
      outcome: 'unchanged',
      changedFields: [],
    })
    const engine = build()
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({ listings: [LISTING_FIXTURE], fingerprintHash: 'abc' }),
    })
    engine.register(adapter, adapter.sourceId)

    const listingsChanged = await engine.runSource('src-1')

    expect(listingsChanged).toBe(false)
    expect(runs.complete).toHaveBeenCalledWith('run-1', 1, { listingsNew: 0, listingsUpdated: 0 })
  })

  it('passes the URL-based sourceRecordKey to markGone when externalId is null', async () => {
    const engine = build()
    const listing = { ...LISTING_FIXTURE, externalId: null, sourceRecordKey: 'http://x.com/1' }
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({ listings: [listing], fingerprintHash: 'abc' }),
    })
    engine.register(adapter, adapter.sourceId)

    await engine.runSource('src-1')

    expect(listings.markGone).toHaveBeenCalledWith('src-1', ['http://x.com/1'], { isCompleteCrawl: true })
  })

  // ─── scrape error ────────────────────────────────────────────────────────────

  it('marks error and rethrows when scrape throws', async () => {
    const engine = build()
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockRejectedValue(new Error('network timeout')),
    })
    engine.register(adapter, adapter.sourceId)

    await expect(engine.runSource('src-1')).rejects.toThrow('network timeout')
    expect(runs.fail).toHaveBeenCalledWith('run-1', 'network timeout')
    expect(sources.markError).toHaveBeenCalledWith('src-1', 'network timeout')
  })

  // ─── geocode error handling ───────────────────────────────────────────────────

  it('logs geocode failure via context when runGeocodeJob rejects with an Error', async () => {
    const engine = build()
    const context = makeContext()
    const adapter = makeAdapter('src-1')
    engine.register(adapter, adapter.sourceId)

    vi.mocked(runGeocodeJob).mockRejectedValueOnce(new Error('redis connection refused'))

    await engine.runSource('src-1', context)

    // Run is still completed — geocode failure is non-fatal
    expect(runs.complete).toHaveBeenCalledWith('run-1', 0, { listingsNew: 0, listingsUpdated: 0 })
    // The error message is forwarded to the job context log
    await vi.waitFor(() => {
      expect(context.log).toHaveBeenCalledWith(
        expect.stringContaining('redis connection refused'),
      )
    })
  })

  it('logs geocode failure via context when runGeocodeJob rejects with a non-Error value', async () => {
    const engine = build()
    const context = makeContext()
    const adapter = makeAdapter('src-1')
    engine.register(adapter, adapter.sourceId)

    vi.mocked(runGeocodeJob).mockRejectedValueOnce('plain string error')

    await engine.runSource('src-1', context)

    expect(runs.complete).toHaveBeenCalledWith('run-1', 0, { listingsNew: 0, listingsUpdated: 0 })
    await vi.waitFor(() => {
      expect(context.log).toHaveBeenCalledWith(
        expect.stringContaining('plain string error'),
      )
    })
  })

  // ─── per-listing publication decision (issue #502) ────────────────────────────
  // Confirms the core AC end-to-end: an isolated bad listing quarantines
  // individually even when the source's overall error rate stays below the
  // fixed 20% systemic threshold — the per-listing gate is not gated by the
  // aggregate check.

  // LISTING_FIXTURE has priceCents:null + sellerType:dealer and dealer.name:null, which trip
  // the warn-severity missing_conditional_field / missing_required_field completeness rules.
  // Those are legitimate warnings (e.g. "price on request") but make the fixture unsuitable
  // as a genuinely clean baseline for asserting qualityIssueCodes is empty, so this block uses
  // its own fully-clean fixture.
  const CLEAN_FIXTURE = {
    ...LISTING_FIXTURE,
    priceCents: 4_500_000,
    dealer: { name: 'MobilityWorks', phone: null, website: 'https://www.mobilityworks.com' },
  }

  it('quarantines an isolated bad listing while publishing clean listings, even when the error rate stays below the systemic threshold', async () => {
    const engine = build()
    const dirtyListing = {
      ...CLEAN_FIXTURE,
      sourceRecordKey: 'bad key with space', // triggers the error-severity contains_space rule
      externalId: 'bad-1',
    }
    // 9 clean listings + 1 dirty listing = 10% error rate, well under SYSTEMIC_ERROR_THRESHOLD (20%)
    // and >= 5 total listings, so the systemic-threshold check is actually exercised (not skipped
    // for being too small a sample).
    const cleanListings = Array.from({ length: 9 }, (_, i) => ({
      ...CLEAN_FIXTURE,
      sourceRecordKey: `clean-${i}`,
      externalId: `clean-${i}`,
    }))
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({
        listings: [dirtyListing, ...cleanListings],
        fingerprintHash: 'abc',
      }),
    })
    engine.register(adapter, adapter.sourceId)

    const result = await engine.runSource('src-1')

    // The run completes successfully — an isolated error-severity listing does not
    // abort the whole run the way a systemic (>=20%) error rate would.
    expect(result).toBe(true)
    expect(runs.fail).not.toHaveBeenCalled()
    expect(sources.markError).not.toHaveBeenCalled()

    const upsertCalls = vi.mocked(listings.upsert).mock.calls.map(([arg]) => arg)
    const dirtyCall = upsertCalls.find((call) => call.sourceRecordKey === 'bad key with space')
    const cleanCalls = upsertCalls.filter((call) => call.sourceRecordKey?.startsWith('clean-'))

    expect(dirtyCall).toMatchObject({
      publicationStatus: 'quarantined',
      qualityIssueCodes: expect.arrayContaining(['contains_space']),
    })
    expect(cleanCalls).toHaveLength(9)
    for (const call of cleanCalls) {
      expect(call).toMatchObject({ publicationStatus: 'eligible', qualityIssueCodes: [] })
    }
  })

  it('aborts the run and does not upsert when the error rate reaches the systemic threshold', async () => {
    const engine = build()
    // 2 of 5 listings (40%) carry the error-severity contains_space issue — over threshold.
    const dirtyListings = Array.from({ length: 2 }, (_, i) => ({
      ...LISTING_FIXTURE,
      sourceRecordKey: `bad key ${i}`,
      externalId: `bad-${i}`,
    }))
    const cleanListings = Array.from({ length: 3 }, (_, i) => ({
      ...LISTING_FIXTURE,
      sourceRecordKey: `clean-${i}`,
      externalId: `clean-${i}`,
    }))
    const adapter = makeAdapter('src-1', {
      scrape: vi.fn().mockResolvedValue({
        listings: [...dirtyListings, ...cleanListings],
        fingerprintHash: 'abc',
      }),
    })
    engine.register(adapter, adapter.sourceId)

    const result = await engine.runSource('src-1')

    expect(result).toBe(false)
    expect(runs.fail).toHaveBeenCalledWith('run-1', expect.stringContaining('Data quality check failed'))
    expect(sources.markError).toHaveBeenCalledWith('src-1', expect.stringContaining('Data quality check failed'))
    expect(listings.upsert).not.toHaveBeenCalled()
  })
})
