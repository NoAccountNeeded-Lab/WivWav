/**
 * Tests for search-reconciliation.ts (issue #642).
 *
 * Covers:
 *   - Expected catalog: eligible unique vehicle groups, deterministic
 *     representative selection (the #530/#669 policy), not raw row count
 *   - Exact match: no divergence reported
 *   - Stale index: canonicalization / value divergence on a changed field
 *   - Duplicate vehicleId documents in Meilisearch
 *   - Missing facet values: optional facets never false-positive; required
 *     facets always do
 *   - Canonical aliases: expected (canonicalized) vs. actual (pre-alias) value
 *   - Multi-valued wavFeatures: order-insensitive match, real divergence caught
 *   - Meilisearch unavailable
 *   - Coverage-drop baseline detection
 *
 * @module
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn() }))
vi.mock('../lib/queue-factory.js', () => ({ getQueueFactory: vi.fn() }))

import { getMeiliClient } from '../lib/meili.js'
import { getQueueFactory } from '../lib/queue-factory.js'
import { toDocument } from '@wivwav/search'
import type { Listing } from '@wivwav/db'
import {
  FACET_SPECS,
  buildDistribution,
  compareFacet,
  computeCoverage,
  computeUnknownRates,
  detectRequiredFacetViolations,
  detectDuplicateVehicleIds,
  detectCanonicalizationDivergence,
  detectCoverageDrops,
  buildExpectedCatalog,
  reconcileSearchCatalog,
  toFacetDoc,
  QUEUE_STATS_TIMEOUT_MS,
  type FacetDoc,
} from './search-reconciliation.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────

let idCounter = 0

function makeListing(overrides: Partial<Listing> = {}): Listing {
  idCounter++
  const base = {
    id: `listing-${idCounter}`,
    sourceId: 'blvd',
    sourceUrl: `https://example.com/${idCounter}`,
    buyerUrl: null,
    externalId: null,
    stockNumber: null,
    sourceRecordKey: `rec-${idCounter}`,

    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: 'LE',
    vin: '1HGBH41JXMN109186',
    condition: 'used',
    sellerType: 'dealer',

    priceCents: 6_500_000,
    mileage: 30_000,
    color: 'White',
    fuelType: 'Gasoline',
    engine: null,
    transmission: 'automatic',

    conversionType: 'rear_entry',
    conversionManufacturer: 'BraunAbility',
    floorLoweringInches: 10,
    rampType: 'fold_out',
    conversionStatus: 'complete',
    wavFeatures: ['hand_controls'],
    wheelchairCapacity: 1,

    zip: '90210',
    city: 'Beverly Hills',
    state: 'CA',
    lat: 34.1,
    lng: -118.4,

    vehicleId: null,
    vehicleModelId: null,
    vehicleModelMatchConfidence: null,

    dealerName: 'Test Dealer',
    dealerPhone: '555-555-5555',
    dealerWebsite: null,
    dealerProfileId: null,

    cardImages: [],
    images: ['https://example.com/img1.jpg'],
    description: 'A fine van',

    isDuplicate: false,
    canonicalId: null,

    status: 'active',
    saleStatus: 'active',
    goneAt: null,
    soldAt: null,

    publicationStatus: 'eligible',
    qualityIssueCodes: [],
    qualityCheckedAt: null,

    missingFromCompleteCount: 0,
    lastSeenInCompleteCrawlAt: null,

    listedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    scrapedAt: new Date('2026-01-01T00:00:00Z'),
    detailScrapedAt: new Date('2026-01-01T00:00:00Z'),
    processingLockedAt: null,
  }
  return { ...base, ...overrides } as unknown as Listing
}

function makeMeiliClient(docs: readonly FacetDoc[]) {
  return {
    index: vi.fn().mockReturnValue({
      getStats: vi.fn().mockResolvedValue({ numberOfDocuments: docs.length }),
      getDocuments: vi.fn(async ({ offset = 0, limit = 500 }: { offset?: number; limit?: number }) => ({
        results: docs.slice(offset, offset + limit),
        total: docs.length,
        offset,
        limit,
      })),
    }),
  }
}

function makeUnavailableMeiliClient() {
  return {
    index: vi.fn().mockReturnValue({
      getStats: vi.fn().mockRejectedValue(new Error('connection refused')),
    }),
  }
}

function makeDb(listings: Listing[], counts: { pending?: number; quarantined?: number } = {}) {
  let called = false
  return {
    listing: {
      findMany: vi.fn(async () => {
        if (called) return []
        called = true
        return listings
      }),
      count: vi.fn()
        .mockResolvedValueOnce(counts.pending ?? 0)
        .mockResolvedValueOnce(counts.quarantined ?? 0),
    },
  }
}

function makeQueueFactory(
  stats: { waiting: number; active: number; delayed: number } | 'unavailable' | 'stalled',
  closeSpy?: ReturnType<typeof vi.fn>,
) {
  const close = closeSpy ?? vi.fn().mockResolvedValue(undefined)
  let getStats: ReturnType<typeof vi.fn>
  if (stats === 'unavailable') {
    getStats = vi.fn().mockRejectedValue(new Error('redis unreachable'))
  } else if (stats === 'stalled') {
    // Never settles — simulates a queue backend that accepts the connection
    // but never replies (#995's reproduced hang), as distinct from an
    // immediate rejection ('unavailable' above).
    getStats = vi.fn(() => new Promise<never>(() => {}))
  } else {
    getStats = vi.fn().mockResolvedValue({ ...stats, completed: 0, failed: 0 })
  }
  return {
    createQueue: vi.fn().mockReturnValue({ getStats, close }),
  }
}

beforeEach(() => {
  idCounter = 0
  vi.clearAllMocks()
  vi.mocked(getQueueFactory).mockReturnValue(makeQueueFactory({ waiting: 0, active: 0, delayed: 0 }) as never)
})

// ── Pure function unit tests ─────────────────────────────────────────────────

describe('buildDistribution', () => {
  it('counts single-valued facets once per document', () => {
    const docs = [
      toFacetDoc(toDocument(makeListing({ make: 'Toyota' }))),
      toFacetDoc(toDocument(makeListing({ make: 'Toyota' }))),
      toFacetDoc(toDocument(makeListing({ make: 'Honda' }))),
    ]
    expect(buildDistribution(docs, 'make')).toEqual({ Toyota: 2, Honda: 1 })
  })

  it('excludes null values from the distribution', () => {
    const docs = [
      toFacetDoc(toDocument(makeListing({ trim: null }))),
      toFacetDoc(toDocument(makeListing({ trim: 'XLE' }))),
    ]
    expect(buildDistribution(docs, 'trim')).toEqual({ XLE: 1 })
  })

  it('counts each distinct multi-valued facet value once per document', () => {
    const docs = [
      toFacetDoc(toDocument(makeListing({ wavFeatures: ['hand_controls', 'has_lift'] }))),
      toFacetDoc(toDocument(makeListing({ wavFeatures: ['has_lift'] }))),
    ]
    expect(buildDistribution(docs, 'wavFeatures')).toEqual({ hand_controls: 1, has_lift: 2 })
  })
})

describe('compareFacet', () => {
  const spec = FACET_SPECS.find((s) => s.key === 'make')!

  it('reports no divergence for identical distributions', () => {
    const docs = [toFacetDoc(toDocument(makeListing({ make: 'Toyota' })))]
    const result = compareFacet(spec, docs, docs)
    expect(result.diverged).toBe(false)
  })

  it('flags values present only in expected', () => {
    const expected = [toFacetDoc(toDocument(makeListing({ make: 'Toyota' })))]
    const result = compareFacet(spec, expected, [])
    expect(result.onlyInExpected).toEqual(['Toyota'])
    expect(result.diverged).toBe(true)
  })

  it('flags values present only in actual', () => {
    const actual = [toFacetDoc(toDocument(makeListing({ make: 'Toyota' })))]
    const result = compareFacet(spec, [], actual)
    expect(result.onlyInActual).toEqual(['Toyota'])
    expect(result.diverged).toBe(true)
  })

  it('flags a count mismatch for a value present on both sides', () => {
    const expected = [
      toFacetDoc(toDocument(makeListing({ make: 'Toyota' }))),
      toFacetDoc(toDocument(makeListing({ make: 'Toyota' }))),
    ]
    const actual = [toFacetDoc(toDocument(makeListing({ make: 'Toyota' })))]
    const result = compareFacet(spec, expected, actual)
    expect(result.countMismatches).toEqual([{ value: 'Toyota', expected: 2, actual: 1 }])
  })
})

describe('computeCoverage', () => {
  it('computes global and per-source coverage for optional facets only', () => {
    const docs = [
      toFacetDoc(toDocument(makeListing({ sourceId: 'blvd', trim: 'LE' }))),
      toFacetDoc(toDocument(makeListing({ sourceId: 'blvd', trim: null }))),
      toFacetDoc(toDocument(makeListing({ sourceId: 'mobilityworks', trim: 'XLE' }))),
    ]
    const coverage = computeCoverage(docs)

    expect(coverage.some((c) => c.field === 'make')).toBe(false) // required facet excluded

    const globalTrim = coverage.find((c) => c.field === 'trim' && c.sourceId === 'global')!
    expect(globalTrim.present).toBe(2)
    expect(globalTrim.total).toBe(3)

    const blvdTrim = coverage.find((c) => c.field === 'trim' && c.sourceId === 'blvd')!
    expect(blvdTrim.present).toBe(1)
    expect(blvdTrim.total).toBe(2)

    const mwTrim = coverage.find((c) => c.field === 'trim' && c.sourceId === 'mobilityworks')!
    expect(mwTrim.present).toBe(1)
    expect(mwTrim.total).toBe(1)
  })
})

describe('computeUnknownRates', () => {
  it('computes the known (non-"unknown") rate for conversionType and rampType', () => {
    const docs = [
      toFacetDoc(toDocument(makeListing({ conversionType: 'rear_entry' }))),
      toFacetDoc(toDocument(makeListing({ conversionType: 'unknown' }))),
    ]
    const rates = computeUnknownRates(docs)
    const conversionType = rates.find((r) => r.field === 'conversionType' && r.sourceId === 'global')!
    expect(conversionType.present).toBe(1)
    expect(conversionType.total).toBe(2)
  })
})

describe('detectRequiredFacetViolations', () => {
  it('does not flag optional facets with sparse coverage', () => {
    const docs = [toFacetDoc(toDocument(makeListing({ trim: null, color: null })))]
    expect(detectRequiredFacetViolations(docs)).toEqual([])
  })

  it('flags a required facet that is missing on an expected document', () => {
    // `make` is required — force it empty via a raw FacetDoc (toDocument itself
    // would never legally leave it empty; this simulates a data-integrity bug).
    const docs: FacetDoc[] = [{ ...toFacetDoc(toDocument(makeListing())), make: '' }]
    const violations = detectRequiredFacetViolations(docs)
    expect(violations.length).toBe(1)
    expect(violations[0]).toMatch(/make/)
  })

  it('treats the year=0 sentinel as missing, not as a valid year', () => {
    const docs: FacetDoc[] = [{ ...toFacetDoc(toDocument(makeListing())), year: 0 }]
    const violations = detectRequiredFacetViolations(docs)
    expect(violations.length).toBe(1)
    expect(violations[0]).toMatch(/year/)
  })
})

describe('detectDuplicateVehicleIds', () => {
  it('returns nothing when every vehicleId is unique or null', () => {
    expect(detectDuplicateVehicleIds([
      { id: 'a', vehicleId: 'v1' },
      { id: 'b', vehicleId: null },
      { id: 'c', vehicleId: 'v2' },
    ])).toEqual([])
  })

  it('flags a vehicleId that appears on more than one document', () => {
    const result = detectDuplicateVehicleIds([
      { id: 'a', vehicleId: 'v1' },
      { id: 'b', vehicleId: 'v1' },
      { id: 'c', vehicleId: 'v2' },
    ])
    expect(result).toEqual([{ vehicleId: 'v1', documentIds: ['a', 'b'] }])
  })
})

describe('detectCanonicalizationDivergence', () => {
  it('finds no divergence when documents match', () => {
    const doc = toFacetDoc(toDocument(makeListing({ id: 'shared' })))
    expect(detectCanonicalizationDivergence([doc], [doc])).toEqual([])
  })

  it('flags a stale canonical value (e.g. a pre-alias-table raw color still indexed)', () => {
    const expected = toFacetDoc(toDocument(makeListing({ id: 'shared', color: 'White' })))
    const actual: FacetDoc = { ...expected, color: 'Oxford White' }
    const divergence = detectCanonicalizationDivergence([expected], [actual])
    expect(divergence).toEqual([{ id: 'shared', field: 'color', expected: 'White', actual: 'Oxford White' }])
  })

  it('treats reordered multi-valued facet values as matching', () => {
    const expected = toFacetDoc(toDocument(makeListing({ id: 'shared', wavFeatures: ['hand_controls', 'has_lift'] })))
    const actual: FacetDoc = { ...expected, wavFeatures: ['has_lift', 'hand_controls'] }
    expect(detectCanonicalizationDivergence([expected], [actual])).toEqual([])
  })

  it('flags a real multi-valued facet divergence', () => {
    const expected = toFacetDoc(toDocument(makeListing({ id: 'shared', wavFeatures: ['hand_controls'] })))
    const actual: FacetDoc = { ...expected, wavFeatures: ['has_lift'] }
    const divergence = detectCanonicalizationDivergence([expected], [actual])
    expect(divergence).toEqual([{ id: 'shared', field: 'wavFeatures', expected: 'hand_controls', actual: 'has_lift' }])
  })

  it('skips documents missing from the actual catalog (reported separately as missing coverage)', () => {
    const expected = toFacetDoc(toDocument(makeListing({ id: 'only-expected' })))
    expect(detectCanonicalizationDivergence([expected], [])).toEqual([])
  })
})

describe('detectCoverageDrops', () => {
  it('returns no alerts when there is no baseline', () => {
    expect(detectCoverageDrops([{ field: 'trim', sourceId: 'global', rate: 0.5 }], null)).toEqual([])
  })

  it('flags a drop at or beyond the threshold', () => {
    const baseline = { capturedAt: '2026-01-01T00:00:00Z', entries: [{ field: 'trim', sourceId: 'global', rate: 0.9 }] }
    const alerts = detectCoverageDrops([{ field: 'trim', sourceId: 'global', rate: 0.7 }], baseline, 0.1)
    expect(alerts.length).toBe(1)
    expect(alerts[0]).toMatchObject({ field: 'trim', sourceId: 'global', previousRate: 0.9, currentRate: 0.7 })
    expect(alerts[0]!.drop).toBeCloseTo(0.2)
  })

  it('does not flag a drop below the threshold', () => {
    const baseline = { capturedAt: '2026-01-01T00:00:00Z', entries: [{ field: 'trim', sourceId: 'global', rate: 0.9 }] }
    const alerts = detectCoverageDrops([{ field: 'trim', sourceId: 'global', rate: 0.85 }], baseline, 0.1)
    expect(alerts).toEqual([])
  })

  it('ignores fields with no matching baseline entry', () => {
    const baseline = { capturedAt: '2026-01-01T00:00:00Z', entries: [] }
    expect(detectCoverageDrops([{ field: 'trim', sourceId: 'global', rate: 0.1 }], baseline)).toEqual([])
  })
})

// ── Expected catalog (grouping/representative policy) ───────────────────────

describe('buildExpectedCatalog', () => {
  it('counts each ungrouped eligible listing as its own document', async () => {
    const db = makeDb([makeListing({ id: 'a' }), makeListing({ id: 'b' })])
    const docs = await buildExpectedCatalog(db as never)
    expect(docs.length).toBe(2)
  })

  it('collapses a verified vehicle group into a single representative — the #642 fix', async () => {
    // Two eligible listings sharing a vehicleId used to both count toward the
    // pre-#642 "expected" total; production search holds only one.
    const stale = makeListing({ id: 'stale', vehicleId: 'veh-1', scrapedAt: new Date('2026-01-01T00:00:00Z') })
    const fresh = makeListing({ id: 'fresh', vehicleId: 'veh-1', scrapedAt: new Date('2026-02-01T00:00:00Z') })
    const db = makeDb([stale, fresh])
    const docs = await buildExpectedCatalog(db as never)
    expect(docs.length).toBe(1)
    expect(docs[0]!.id).toBe('fresh') // more recently scraped wins
  })
})

// ── Orchestrator ─────────────────────────────────────────────────────────────

describe('reconcileSearchCatalog', () => {
  it('reports no divergence for an exact match against the fixture catalog', async () => {
    const rows = [makeListing({ id: 'a' }), makeListing({ id: 'b', sourceId: 'mobilityworks' })]
    const db = makeDb(rows)
    const expectedDocs = rows.map((r) => toFacetDoc(toDocument(r)))
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient(expectedDocs) as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.available).toBe(true)
    expect(report.countDivergence).toBe(false)
    expect(report.missingFromIndex.count).toBe(0)
    expect(report.unexpectedInIndex.count).toBe(0)
    expect(report.canonicalizationDivergenceCount).toBe(0)
    expect(report.duplicateVehicleIds).toEqual([])
    expect(report.facetComparisons.every((f) => !f.diverged)).toBe(true)
    expect(report.invariantViolations).toEqual([])
  })

  it('detects a stale index entry as canonicalization divergence and facet divergence', async () => {
    const row = makeListing({ id: 'a', color: 'Silver' })
    const db = makeDb([row])
    const staleActual: FacetDoc = { ...toFacetDoc(toDocument(row)), color: 'White' }
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([staleActual]) as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.canonicalizationDivergenceCount).toBe(1)
    expect(report.canonicalizationDivergenceSamples[0]).toMatchObject({ id: 'a', field: 'color', expected: 'Silver', actual: 'White' })
    const colorFacet = report.facetComparisons.find((f) => f.facet === 'color')!
    expect(colorFacet.diverged).toBe(true)
  })

  it('detects duplicate vehicleId documents in the index', async () => {
    const row = makeListing({ id: 'rep', vehicleId: 'veh-1' })
    const db = makeDb([row])
    const repDoc = toFacetDoc(toDocument(row))
    const staleDoc: FacetDoc = { ...repDoc, id: 'stale-leftover' }
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([repDoc, staleDoc]) as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.duplicateVehicleIds).toEqual([{ vehicleId: 'veh-1', documentIds: ['rep', 'stale-leftover'] }])
    expect(report.invariantViolations.some((v) => v.includes('vehicle group'))).toBe(true)
  })

  it('reports missing and unexpected documents without false-flagging optional facet sparsity', async () => {
    const present = makeListing({ id: 'present', trim: null }) // optional field null — must not be an invariant violation
    const missing = makeListing({ id: 'missing-from-index' })
    const db = makeDb([present, missing])
    const orphan: FacetDoc = { ...toFacetDoc(toDocument(present)), id: 'orphan-in-index' }
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([toFacetDoc(toDocument(present)), orphan]) as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.missingFromIndex).toEqual({ count: 1, sampleIds: ['missing-from-index'] })
    expect(report.unexpectedInIndex).toEqual({ count: 1, sampleIds: ['orphan-in-index'] })
    expect(report.invariantViolations).toEqual([])
  })

  it('handles Meilisearch being unavailable gracefully', async () => {
    const db = makeDb([makeListing({ id: 'a' })])
    vi.mocked(getMeiliClient).mockReturnValue(makeUnavailableMeiliClient() as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.available).toBe(false)
    expect(report.actualTotal).toBeNull()
    expect(report.note).toMatch(/unavailable/)
    expect(report.facetComparisons).toEqual([])
  })

  it('reports pending/quarantined counts and the listing-resolve queue backlog', async () => {
    const db = makeDb([makeListing({ id: 'a' })], { pending: 4, quarantined: 2 })
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([]) as never)
    vi.mocked(getQueueFactory).mockReturnValue(makeQueueFactory({ waiting: 3, active: 1, delayed: 0 }) as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.publicationBacklog).toEqual({ pending: 4, quarantined: 2, listingResolveBacklog: 4 })
  })

  it('reports a null queue backlog when the queue backend is unreachable', async () => {
    const db = makeDb([makeListing({ id: 'a' })])
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([]) as never)
    vi.mocked(getQueueFactory).mockReturnValue(makeQueueFactory('unavailable') as never)

    const report = await reconcileSearchCatalog(db as never)

    expect(report.publicationBacklog.listingResolveBacklog).toBeNull()
  })

  it('resolves within the timeout window — not hanging — when the queue backend stalls, and closes the connection (#995)', async () => {
    const db = makeDb([makeListing({ id: 'a' })])
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([]) as never)
    const close = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getQueueFactory).mockReturnValue(makeQueueFactory('stalled', close) as never)

    vi.useFakeTimers()
    try {
      const reportPromise = reconcileSearchCatalog(db as never)
      // Advance past QUEUE_STATS_TIMEOUT_MS (with margin) without ever
      // settling `getStats()` — reproduces the queue backend that accepts a
      // connection but never replies. Prior to the fix, `getPublicationBacklog`
      // itself resolved on time, but the abandoned queue connection was never
      // closed, leaving the process (and, in the mocked case, an open call to
      // `close()` that never happened) hanging indefinitely.
      await vi.advanceTimersByTimeAsync(QUEUE_STATS_TIMEOUT_MS + 500)
      const report = await reportPromise

      expect(report.publicationBacklog.listingResolveBacklog).toBeNull()
    } finally {
      vi.useRealTimers()
    }

    expect(close).toHaveBeenCalled()
  })

  it('still resolves within (2 * timeout) when the cleanup close() itself stalls (#995)', async () => {
    const db = makeDb([makeListing({ id: 'a' })])
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient([]) as never)
    // Both `getStats()` and the cleanup `close()` hang — e.g. a backend that
    // accepted the connection and reached "ready" before going unresponsive,
    // so `getPublicationBacklog`'s own `withTimeout(queue.close(), ...)`
    // backstop is what has to bound this, not `BullMQQueueAdapter#close()`
    // (which this mock bypasses entirely).
    const close = vi.fn(() => new Promise<never>(() => {}))
    vi.mocked(getQueueFactory).mockReturnValue(makeQueueFactory('stalled', close) as never)

    vi.useFakeTimers()
    try {
      const reportPromise = reconcileSearchCatalog(db as never)
      await vi.advanceTimersByTimeAsync(2 * QUEUE_STATS_TIMEOUT_MS + 500)
      const report = await reportPromise

      expect(report.publicationBacklog.listingResolveBacklog).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies a supplied coverage baseline and flags a coverage drop', async () => {
    const rows = [
      makeListing({ id: 'a', trim: null }),
      makeListing({ id: 'b', trim: null }),
    ]
    const db = makeDb(rows)
    const expectedDocs = rows.map((r) => toFacetDoc(toDocument(r)))
    vi.mocked(getMeiliClient).mockReturnValue(makeMeiliClient(expectedDocs) as never)

    const baseline = {
      capturedAt: '2026-01-01T00:00:00Z',
      entries: [{ field: 'trim', sourceId: 'global', rate: 0.9 }],
    }

    const report = await reconcileSearchCatalog(db as never, { baseline, coverageDropThreshold: 0.1 })

    expect(report.coverageDropAlerts.some((a) => a.field === 'trim' && a.sourceId === 'global')).toBe(true)
  })
})
