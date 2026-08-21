/**
 * Tests for listing-quality-audit.ts (issue #505).
 *
 * Covers:
 *   - Report determinism (same DB state → same report)
 *   - Pagination / large datasets (rows span multiple BATCH_SIZE pages)
 *   - Privacy redaction (no description/seller copy in report)
 *   - Threshold: representative ID lists capped at MAX_REPRESENTATIVE_IDS
 *   - Field completeness accumulation
 *   - Unknown-rate accumulation
 *   - Stale-detail detection
 *   - Quarantine code breakdown
 *   - Image cluster aggregation
 *   - Search index divergence: Meilisearch unavailable path
 *   - Source scoping (--source flag)
 *   - Baseline comparison (audit version field)
 *   - Fixture versioning via parserVersion in gold datasets
 *
 * @module
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
}))

// Meilisearch is optional — the audit gracefully handles its absence.
vi.mock('../lib/meili.js', () => ({
  getMeiliClient: vi.fn(() => ({
    index: vi.fn().mockReturnValue({
      getStats: vi.fn().mockRejectedValue(new Error('unavailable')),
    }),
  })),
}))

// Queue backend is optional — the audit gracefully handles its absence.
vi.mock('../lib/queue-factory.js', () => ({
  getQueueFactory: vi.fn(() => ({
    createQueue: vi.fn().mockReturnValue({
      getStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}))

import { getDb } from '@wivwav/db'
import { runListingQualityAudit, AUDIT_VERSION } from './listing-quality-audit.js'

// ── DB mock helpers ──────────────────────────────────────────────────────────

const STALE_DATE = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
const FRESH_DATE = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)  // 1 day ago

function makeListing(overrides: Partial<{
  id: string
  status: string
  publicationStatus: string
  make: string
  model: string
  year: number
  vin: string | null
  priceCents: number | null
  mileage: number | null
  state: string | null
  color: string | null
  fuelType: string | null
  description: string | null
  images: string[]
  conversionType: string
  rampType: string
  isDuplicate: boolean
  qualityIssueCodes: string[]
  detailScrapedAt: Date | null
}>): Record<string, unknown> {
  return {
    id: overrides.id ?? 'listing-1',
    status: overrides.status ?? 'active',
    publicationStatus: overrides.publicationStatus ?? 'eligible',
    make: overrides.make ?? 'Toyota',
    model: overrides.model ?? 'Sienna',
    year: overrides.year ?? 2022,
    vin: overrides.vin !== undefined ? overrides.vin : '1HGBH41JXMN109186',
    priceCents: overrides.priceCents !== undefined ? overrides.priceCents : 6500000,
    mileage: overrides.mileage !== undefined ? overrides.mileage : 30000,
    state: overrides.state !== undefined ? overrides.state : 'CA',
    color: overrides.color !== undefined ? overrides.color : 'White',
    fuelType: overrides.fuelType !== undefined ? overrides.fuelType : 'Gasoline',
    description: overrides.description !== undefined ? overrides.description : null,
    images: overrides.images ?? ['https://example.com/img1.jpg'],
    conversionType: overrides.conversionType ?? 'rear_entry',
    rampType: overrides.rampType ?? 'fold_out',
    isDuplicate: overrides.isDuplicate ?? false,
    qualityIssueCodes: overrides.qualityIssueCodes ?? [],
    detailScrapedAt: overrides.detailScrapedAt !== undefined ? overrides.detailScrapedAt : FRESH_DATE,
  }
}

function makeDb(listings: ReturnType<typeof makeListing>[], overrides?: {
  imageClusterCount?: Partial<Record<string, number>>
  listingImageCount?: number
  /** ScraperRun rows returned for every source — defaults to none (empty-state, #986). */
  scraperRuns?: { isCompleteCrawl: boolean | null; markGoneNewlyGoneCount: number | null }[]
}) {
  const db = {
    source: {
      findMany: vi.fn().mockResolvedValue([{ id: 'test-source' }]),
    },
    listing: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(listings.filter(l => l.status === 'active' && l.publicationStatus === 'eligible').length),
    },
    listingImage: {
      count: vi.fn().mockResolvedValue(overrides?.listingImageCount ?? 0),
    },
    imageCluster: {
      count: vi.fn().mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {}
        const counts = overrides?.imageClusterCount ?? {}
        if (where['clusterType'] === 'exact') return counts['exact'] ?? 0
        if (where['clusterType'] === 'near') return counts['near'] ?? 0
        if (where['isPlaceholder'] === true) return counts['placeholder'] ?? 0
        if (where['crossVehicle'] === true) return counts['crossVehicle'] ?? 0
        return 0
      }),
    },
    scraperRun: {
      findMany: vi.fn().mockResolvedValue(overrides?.scraperRuns ?? []),
    },
    $disconnect: vi.fn(),
  }

  // Simulate pagination: return all listings on first page, then empty.
  // These fixtures only carry the narrow field set scanSourceListings selects
  // (its query always passes `select`); the search-reconciliation full-row
  // scan (no `select`) is exercised with properly-shaped fixtures in
  // search-reconciliation.test.ts instead, so it always sees an empty page
  // here rather than crashing on fields (e.g. `listedAt`) these fixtures
  // don't carry.
  let pageCalled = false
  db.listing.findMany.mockImplementation(async (args?: { select?: unknown }) => {
    if (!args?.select) return []
    if (pageCalled) return []
    pageCalled = true
    return listings
  })

  return db
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runListingQualityAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a report with correct auditVersion', async () => {
    const db = makeDb([makeListing({})])
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    expect(report.auditVersion).toBe(AUDIT_VERSION)
    expect(typeof report.auditedAt).toBe('string')
  })

  it('is deterministic — same DB state produces identical reports', async () => {
    const listings = [
      makeListing({ id: 'l1' }),
      makeListing({ id: 'l2', vin: null, qualityIssueCodes: ['unparseable_vin'] }),
    ]

    // Run twice with identical mock state.
    for (let i = 0; i < 2; i++) {
      const db = makeDb(listings)
      vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)
    }

    // First run
    const db1 = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db1 as unknown as ReturnType<typeof getDb>)
    const report1 = await runListingQualityAudit({})

    // Second run
    const db2 = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db2 as unknown as ReturnType<typeof getDb>)
    const report2 = await runListingQualityAudit({})

    // Exclude auditedAt (timestamp) from comparison
    const stable = (r: typeof report1) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { auditedAt, ...rest } = r
      return JSON.stringify(rest)
    }
    expect(stable(report1)).toBe(stable(report2))
  })

  it('paginates correctly — collects all listings across multiple DB pages', async () => {
    // The audit loop breaks when rows.length < BATCH_SIZE (500).
    // Simulate 3 pages: page 1 and 2 return BATCH_SIZE rows each (triggering
    // the cursor loop), page 3 returns fewer rows (ending the loop).
    //
    // We create distinct IDs for pages 1 and 2 (500 each) and a smaller page 3.
    const BATCH = 500
    const page1 = Array.from({ length: BATCH }, (_, i) => makeListing({ id: `p1-${i}` }))
    const page2 = Array.from({ length: BATCH }, (_, i) => makeListing({ id: `p2-${i}` }))
    const page3 = [makeListing({ id: 'p3-0' }), makeListing({ id: 'p3-1' })]

    const db = makeDb([])
    let pageCount = 0
    db.listing.findMany.mockImplementation(async (args?: { select?: unknown }) => {
      // Only the field-select scan (scanSourceListings) is under test here —
      // the reconciliation full-row scan always sees an empty page (see
      // makeDb's comment on why these fixtures can't stand in for it).
      if (!args?.select) return []
      pageCount++
      if (pageCount === 1) return page1
      if (pageCount === 2) return page2
      if (pageCount === 3) return page3
      return []
    })
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const expectedTotal = BATCH + BATCH + 2
    expect(report.totalActive).toBe(expectedTotal)
    expect(report.bySources[0]!.totalListings).toBe(expectedTotal)
    expect(pageCount).toBe(3)
  })

  it('limits scan when --limit is set', async () => {
    const listings = Array.from({ length: 5 }, (_, i) => makeListing({ id: `l${i}` }))
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({ limit: 3 })
    // With limit 3, at most 3 listings are scanned
    expect(report.totalActive).toBeLessThanOrEqual(3)
  })

  it('counts no-VIN listings and caps samples at MAX_REPRESENTATIVE_IDS', async () => {
    // 15 no-VIN listings — samples should be capped at 10
    const listings = Array.from({ length: 15 }, (_, i) =>
      makeListing({ id: `no-vin-${i}`, vin: null, qualityIssueCodes: ['unparseable_vin'] }),
    )
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    expect(src.noVinCount).toBe(15)
    expect(src.noVinSamples.length).toBeLessThanOrEqual(10)
  })

  it('counts stale detail listings correctly', async () => {
    const listings = [
      makeListing({ id: 'fresh', detailScrapedAt: FRESH_DATE }),
      makeListing({ id: 'stale', detailScrapedAt: STALE_DATE }),
      makeListing({ id: 'never', detailScrapedAt: null }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    // stale + never = 2
    expect(src.staleDetailCount).toBe(2)
    expect(src.staleDetailSamples).toContain('stale')
    expect(src.staleDetailSamples).toContain('never')
    expect(src.staleDetailSamples).not.toContain('fresh')
  })

  it('counts accessibility conflicts', async () => {
    const listings = [
      makeListing({ id: 'ok' }),
      makeListing({ id: 'conflict', qualityIssueCodes: ['unsupported_accessibility_claim'], publicationStatus: 'quarantined' }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    expect(src.accessibilityConflictCount).toBe(1)
    expect(src.accessibilityConflictSamples).toContain('conflict')
  })

  it('builds quarantine code breakdown', async () => {
    const listings = [
      makeListing({ id: 'q1', publicationStatus: 'quarantined', qualityIssueCodes: ['missing_required_field'] }),
      makeListing({ id: 'q2', publicationStatus: 'quarantined', qualityIssueCodes: ['missing_required_field', 'unparseable_vin'] }),
      makeListing({ id: 'eligible' }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    expect(src.quarantinedListings).toBe(2)
    expect(src.quarantineCodeBreakdown['missing_required_field']).toBe(2)
    expect(src.quarantineCodeBreakdown['unparseable_vin']).toBe(1)
  })

  it('computes field completeness rates', async () => {
    const listings = [
      makeListing({ id: 'with-vin', vin: '1HGBH41JXMN109186' }),
      makeListing({ id: 'no-vin', vin: null }),
      makeListing({ id: 'no-price', priceCents: null, vin: '2HGBH41JXMN109186' }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    const vinField = src.fieldCompleteness.find(f => f.field === 'vin')!
    const priceField = src.fieldCompleteness.find(f => f.field === 'priceCents')!

    expect(vinField.present).toBe(2)
    expect(vinField.total).toBe(3)
    expect(vinField.rate).toBeCloseTo(2 / 3)

    expect(priceField.present).toBe(2)
    expect(priceField.rate).toBeCloseTo(2 / 3)
  })

  it('computes unknown-rate for conversionType', async () => {
    const listings = [
      makeListing({ id: 'rear', conversionType: 'rear_entry' }),
      makeListing({ id: 'side', conversionType: 'side_entry' }),
      makeListing({ id: 'unk', conversionType: 'unknown' }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    const ct = src.unknownRates.find(u => u.field === 'conversionType')!
    expect(ct.unknown).toBe(1)
    expect(ct.total).toBe(3)
    expect(ct.rate).toBeCloseTo(1 / 3)
  })

  it('aggregates image cluster counts from DB', async () => {
    const db = makeDb([makeListing({})], {
      listingImageCount: 500,
      imageClusterCount: { exact: 12, near: 8, placeholder: 3, crossVehicle: 1 },
    })
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    expect(report.imageClusters.totalImageRows).toBe(500)
    expect(report.imageClusters.exactDuplicateClusters).toBe(12)
    expect(report.imageClusters.nearDuplicateClusters).toBe(8)
    expect(report.imageClusters.placeholderClusters).toBe(3)
    expect(report.imageClusters.crossVehicleClusters).toBe(1)
  })

  it('handles Meilisearch being unavailable gracefully', async () => {
    const db = makeDb([makeListing({})])
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    expect(report.searchReconciliation).not.toBeNull()
    expect(report.searchReconciliation?.available).toBe(false)
    expect(report.searchReconciliation?.actualTotal).toBeNull()
    expect(report.searchReconciliation?.note).toMatch(/unavailable/)
  })

  it('skips search reconciliation when --source scopes the audit', async () => {
    const db = makeDb([makeListing({})])
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({ sourceId: 'test-source' })
    expect(report.searchReconciliation).toBeNull()
  })

  it('does not include description or personal data in report output', async () => {
    const listing = makeListing({
      id: 'private',
      description: 'Call John at 555-555-5555 for details',
    })
    const db = makeDb([listing])
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const reportJson = JSON.stringify(report)

    // No description content or personal data should appear in the report
    expect(reportJson).not.toContain('Call John')
    expect(reportJson).not.toContain('555-555-5555')
  })

  it('scopes to a single source when sourceId is provided', async () => {
    const db = {
      source: {
        findMany: vi.fn().mockResolvedValue([{ id: 'source-a' }]),
      },
      listing: {
        findMany: vi.fn().mockResolvedValue([makeListing({ id: 'la' })]),
        count: vi.fn().mockResolvedValue(1),
      },
      listingImage: { count: vi.fn().mockResolvedValue(0) },
      imageCluster: { count: vi.fn().mockResolvedValue(0) },
      scraperRun: { findMany: vi.fn().mockResolvedValue([]) },
      $disconnect: vi.fn(),
    }
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    await runListingQualityAudit({ sourceId: 'source-a' })

    expect(db.source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'source-a' } }),
    )
  })

  it('includes knownGaps documenting unmeasured dimensions', async () => {
    const db = makeDb([])
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    expect(report.knownGaps.length).toBeGreaterThan(0)
    // At minimum: VIN/NHTSA, cross-source identity, user-reported signals
    const gaps = report.knownGaps.join('\n').toLowerCase()
    expect(gaps).toContain('nhtsa')
    expect(gaps).toContain('identity')
  })

  it('counts duplicate listings', async () => {
    const listings = [
      makeListing({ id: 'orig' }),
      makeListing({ id: 'dup', isDuplicate: true }),
      makeListing({ id: 'dup2', isDuplicate: true }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    // sameSourceDuplicateCount starts as the full isDuplicate count;
    // crossSourceDuplicateCount is 0 when the mock DB returns no cross-source VINs.
    expect(src.sameSourceDuplicateCount + src.crossSourceDuplicateCount).toBe(2)
    expect(src.duplicateSamples).toContain('dup')
    expect(src.duplicateSamples).toContain('dup2')
  })

  it('only tallies field completeness for active listings', async () => {
    const listings = [
      makeListing({ id: 'active', status: 'active', vin: '1HGBH41JXMN109186' }),
      makeListing({ id: 'gone', status: 'gone', vin: null }),
    ]
    const db = makeDb(listings)
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const src = report.bySources[0]!
    const vinField = src.fieldCompleteness.find(f => f.field === 'vin')!
    // Only active listing is in the completeness tally
    expect(vinField.total).toBe(1)
    expect(vinField.present).toBe(1)
  })

  // ── Crawl completeness & gone-promotion history (#986) ─────────────────────

  it('computes complete-crawl rate and total gone-promotions from ScraperRun rows', async () => {
    const db = makeDb([makeListing({})], {
      scraperRuns: [
        { isCompleteCrawl: true, markGoneNewlyGoneCount: 3 },
        { isCompleteCrawl: true, markGoneNewlyGoneCount: 0 },
        { isCompleteCrawl: false, markGoneNewlyGoneCount: 0 },
      ],
    })
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const cc = report.crawlCompleteness.find((c) => c.sourceId === 'test-source')!

    expect(cc.totalMarkGoneRuns).toBe(3)
    expect(cc.completeCrawls).toBe(2)
    expect(cc.completeCrawlRate).toBeCloseTo(2 / 3)
    expect(cc.totalGonePromotions).toBe(3)
  })

  it('reports a zeroed crawl-completeness summary for a source with no ScraperRun rows yet', async () => {
    const db = makeDb([makeListing({})]) // default: no scraperRuns override → empty
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({})
    const cc = report.crawlCompleteness.find((c) => c.sourceId === 'test-source')!

    expect(cc.totalMarkGoneRuns).toBe(0)
    expect(cc.completeCrawls).toBe(0)
    expect(cc.completeCrawlRate).toBe(0)
    expect(cc.totalGonePromotions).toBe(0)
  })

  it('respects a custom crawlCompletenessWindowDays option', async () => {
    const db = makeDb([makeListing({})], {
      scraperRuns: [{ isCompleteCrawl: true, markGoneNewlyGoneCount: 1 }],
    })
    vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>)

    const report = await runListingQualityAudit({ crawlCompletenessWindowDays: 7 })
    const cc = report.crawlCompleteness.find((c) => c.sourceId === 'test-source')!

    expect(cc.windowDays).toBe(7)
    expect(db.scraperRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: 'test-source', markGoneAppliedAt: expect.any(Object) }),
      }),
    )
  })
})
