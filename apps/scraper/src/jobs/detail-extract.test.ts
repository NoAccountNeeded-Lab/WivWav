import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { FieldMapping } from '@wivwav/types'
import type * as WivwavDbModule from '@wivwav/db'
import type * as MobilityworksDetailModule from '../sources/mobilityworks-detail.js'
import type * as SourceListingDatesModule from '../sources/source-listing-dates.js'
import type * as DeclarativeDetailModule from '../sources/declarative-detail.js'
import type * as DetailClaimsModule from '../resolution/detail-claims.js'

vi.mock('@wivwav/db', async () => {
  const actual = await vi.importActual<typeof WivwavDbModule>('@wivwav/db')
  return { ...actual, getDb: vi.fn() }
})
vi.mock('../sources/mobilityworks-detail.js', async () => {
  const actual = await vi.importActual<typeof MobilityworksDetailModule>(
    '../sources/mobilityworks-detail.js',
  )
  // Only evaluateMwDetail touches the (unavailable, in this unit test) DOM;
  // parseMwDetail is a pure function over its raw output and runs for real.
  return {
    ...actual,
    evaluateMwDetail: vi.fn(),
  }
})
vi.mock('../sources/declarative-detail.js', async () => {
  const actual = await vi.importActual<typeof DeclarativeDetailModule>(
    '../sources/declarative-detail.js',
  )
  // Only evaluateDeclarativeDetail touches the (unavailable, in this unit
  // test) DOM/XPath evaluation; parseDeclarativeDetail is a pure function
  // over its raw output and runs for real.
  return {
    ...actual,
    evaluateDeclarativeDetail: vi.fn(),
  }
})
vi.mock('../sources/source-listing-dates.js', async () => {
  const actual = await vi.importActual<typeof SourceListingDatesModule>(
    '../sources/source-listing-dates.js',
  )
  return {
    ...actual,
    evaluateSourceListingDates: vi.fn(),
  }
})
vi.mock('../resolution/detail-claims.js', async () => {
  const actual = await vi.importActual<typeof DetailClaimsModule>(
    '../resolution/detail-claims.js',
  )
  return {
    ...actual,
    recordDetailFieldClaims: vi.fn().mockResolvedValue(undefined),
  }
})

import { getDb } from '@wivwav/db'
import {
  buildListingDetailUpdateData,
  blvdEvidence,
  changedDetailFields,
  detailObservationReference,
  requiresListingResolution,
  resolveListingStatus,
  summarizeError,
} from './detail-extract.js'
import { runDetailExtractJob } from './detail-extract.js'
import type { RawDetail } from '../sources/blvd-detail.js'
import { evaluateMwDetail } from '../sources/mobilityworks-detail.js'
import { evaluateDeclarativeDetail } from '../sources/declarative-detail.js'
import type { RawDeclarativeDetail } from '../sources/declarative-detail.js'
import { evaluateSourceListingDates } from '../sources/source-listing-dates.js'
import type { RawMwDetail } from '../sources/mobilityworks-detail.js'
import { MockBrowserService } from '../browser/index.js'
import type { MockPageRecord } from '../browser/index.js'

const NOW = new Date('2026-06-02T00:00:00Z')

// ── Fixtures for runDetailExtractJob integration-style tests ────────────────

function rawPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'raw-1',
    url: 'https://www.mobilityworks.com/listing/1',
    html: '<html></html>',
    scrapedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
}

function baseListingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sourceRecordKey: 'listing-1',
    externalId: null,
    stockNumber: null,
    status: 'active',
    soldAt: null,
    vin: null,
    missingFromCompleteCount: 0,
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    rampType: 'unknown',
    wavFeatures: [],
    floorLoweringInches: null,
    wheelchairCapacity: null,
    description: null,
    images: [],
    zip: null,
    dealerPhone: null,
    dealerWebsite: null,
    buyerUrl: null,
    saleStatus: 'active',
    sourceListedAt: null,
    sourceUpdatedAt: null,
    goneAt: null,
    publicationStatus: 'pending',
    qualityIssueCodes: [],
    qualityCheckedAt: null,
    detailScrapedAt: null,
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  }
}

function rawMwDetail(overrides: Partial<RawMwDetail> = {}): RawMwDetail {
  return {
    specs: { 'Exterior Color': 'Silver', 'Fuel Type': 'Gasoline', Transmission: 'Automatic' },
    descriptionText: 'Clean, low-mileage conversion.',
    descriptionFound: true,
    imageUrls: ['https://www.mobilityworks.com/img1.jpg'],
    galleryFound: true,
    dealerPhone: '555-0100',
    dealerAddressText: 'Columbus, OH 43085',
    statusBannerText: '',
    ...overrides,
  }
}

function makeTx() {
  return {
    listing: { update: vi.fn().mockResolvedValue({}) },
    listingObservation: { create: vi.fn().mockResolvedValue({}) },
  }
}

function makeExtractDb(overrides: Record<string, unknown> = {}) {
  const tx = makeTx()
  const listingObservationFindUnique = vi.fn().mockResolvedValue(null)
  return {
    source: {
      findUnique: vi.fn().mockResolvedValue({ status: 'active', errorMessage: null }),
    },
    rawPage: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    listing: {
      findFirst: vi.fn().mockResolvedValue(baseListingRow()),
    },
    listingObservation: {
      findUnique: listingObservationFindUnique,
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => fn(tx)),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    __tx: tx,
    __listingObservationFindUnique: listingObservationFindUnique,
    ...overrides,
  }
}

function makeBrowser(pages: Map<string, MockPageRecord> = new Map()) {
  return new MockBrowserService(pages)
}

describe('runDetailExtractJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(evaluateSourceListingDates).mockResolvedValue({
      sourceListedAt: null,
      sourceUpdatedAt: null,
    })
  })

  it('rejects an empty source id before querying the database', async () => {
    await expect(runDetailExtractJob('   ')).rejects.toThrow(
      '[detail-extract] sourceId must be a non-empty string',
    )
    expect(getDb).not.toHaveBeenCalled()
  })

  it('skips stale queued work when the source is disabled', async () => {
    const db = makeExtractDb({
      source: {
        findUnique: vi.fn().mockResolvedValue({ status: 'disabled', errorMessage: 'Operator rollback' }),
      },
      rawPage: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    expect(db.rawPage.findMany).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalledOnce()
  })

  it('commits successful pages, leaves failed pages retryable, and fails the job on a mixed-success batch (refs #637)', async () => {
    const pages = [rawPage({ id: 'raw-1', url: 'https://www.mobilityworks.com/listing/1' }), rawPage({ id: 'raw-2', url: 'https://www.mobilityworks.com/listing/2' })]
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue(pages),
        update: vi.fn().mockResolvedValue({}),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail)
      .mockResolvedValueOnce(rawMwDetail())
      .mockRejectedValueOnce(new Error('parser failure: unexpected DOM shape'))

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).rejects.toThrow(
      '[detail-extract] 1 of 2 raw page(s) failed extraction for source src-1 (1 succeeded)',
    )

    // Page 1 (success) is committed: listing update + observation + processedAt.
    expect(db.__tx.listing.update).toHaveBeenCalledTimes(1)
    expect(db.__tx.listingObservation.create).toHaveBeenCalledTimes(1)
    expect(db.rawPage.update).toHaveBeenCalledTimes(1)
    expect(db.rawPage.update).toHaveBeenCalledWith({
      where: { id: 'raw-1' },
      data: { processedAt: expect.any(Date) },
    })
    // Page 2 (failure) is left untouched — processedAt stays null, retryable.
    expect(db.rawPage.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'raw-2' } }),
    )
    // Cleanup still runs before the job is reported failed.
    expect(db.$disconnect).toHaveBeenCalledTimes(1)
  })

  it('does not fail the job when every page in the batch succeeds', async () => {
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage()]),
        update: vi.fn().mockResolvedValue({}),
      },
      listing: {
        findFirst: vi.fn().mockResolvedValue(baseListingRow({
          sourceRecordKey: 'source-record-1',
          externalId: 'external-1',
          stockNumber: 'stock-1',
          vin: '5TDYRKEC8RS205440',
        })),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()
    expect(db.rawPage.update).toHaveBeenCalledWith({
      where: { id: 'raw-1' },
      data: { processedAt: expect.any(Date) },
    })
    expect(evaluateSourceListingDates).toHaveBeenCalledWith(expect.anything(), {
      expectedUrl: 'https://www.mobilityworks.com/listing/1',
      expectedVin: '5TDYRKEC8RS205440',
      expectedSourceIdentifiers: ['source-record-1', 'external-1', 'stock-1'],
    })
  })

  it('counts a database failure as a failed page without touching processedAt, and fails the job', async () => {
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage()]),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockRejectedValue(new Error('could not serialize access due to concurrent update')),
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).rejects.toThrow(
      '[detail-extract] 1 of 1 raw page(s) failed extraction for source src-1 (0 succeeded)',
    )
    expect(db.rawPage.update).not.toHaveBeenCalled()
  })

  it('treats an already-applied detail observation as success without re-applying it (idempotent retry)', async () => {
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage()]),
        update: vi.fn().mockResolvedValue({}),
      },
      listingObservation: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { stage_reference: { stage: string } } }) => {
          return where.stage_reference.stage === 'detail'
            ? Promise.resolve({ id: 'observation-1', changedFields: [] })
            : Promise.resolve(null)
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.rawPage.update).toHaveBeenCalledWith({
      where: { id: 'raw-1' },
      data: { processedAt: expect.any(Date) },
    })
  })

  it('re-attempts resolution enqueue on retry when the detail observation was committed but the prior enqueue failed', async () => {
    const page = rawPage()
    const listing = baseListingRow({
      rampType: 'fold_out',
      description: 'Previously scraped copy.',
      detailScrapedAt: NOW,
    })
    const observations = new Map<string, { id: string; changedFields: string[] }>([
      ['detail', { id: 'detail-observation-1', changedFields: ['rampType'] }],
    ])
    const listingObservationFindUnique = vi.fn().mockImplementation(
      ({ where }: { where: { stage_reference: { stage: string; reference: string } } }) =>
        Promise.resolve(observations.get(where.stage_reference.stage) ?? null),
    )
    const listingObservationUpsert = vi.fn().mockImplementation(
      ({ create }: { create: { stage: string; changedFields: string[] } }) => {
        observations.set(create.stage, { id: `${create.stage}-1`, changedFields: create.changedFields })
        return Promise.resolve({})
      },
    )
    const resolutionQueue = {
      add: vi.fn()
        .mockRejectedValueOnce(new Error('valkey unavailable'))
        .mockResolvedValueOnce('job-2'),
    }
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn()
          .mockResolvedValueOnce([page])
          .mockResolvedValueOnce([page]),
        update: vi.fn().mockResolvedValue({}),
      },
      listing: {
        findFirst: vi.fn().mockResolvedValue(listing),
      },
      listingObservation: {
        findUnique: listingObservationFindUnique,
        upsert: listingObservationUpsert,
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser(), resolutionQueue as never)).rejects.toThrow(
      '[detail-extract] 1 of 1 raw page(s) failed extraction for source src-1 (0 succeeded)',
    )
    await expect(runDetailExtractJob('src-1', undefined, makeBrowser(), resolutionQueue as never)).resolves.toBeUndefined()

    expect(resolutionQueue.add).toHaveBeenCalledTimes(2)
    expect(resolutionQueue.add).toHaveBeenNthCalledWith(
      1,
      { listingId: 'listing-1', observationReference: detailObservationReference(page) },
      expect.objectContaining({ jobId: `detail-resolution:${detailObservationReference(page)}` }),
    )
    expect(resolutionQueue.add).toHaveBeenNthCalledWith(
      2,
      { listingId: 'listing-1', observationReference: detailObservationReference(page) },
      expect.objectContaining({ jobId: `detail-resolution:${detailObservationReference(page)}` }),
    )
    expect(listingObservationUpsert).toHaveBeenCalledTimes(1)
    expect(db.rawPage.update).toHaveBeenCalledTimes(1)
  })

  it('does not re-enqueue resolution work on retry after the enqueue already succeeded', async () => {
    const page = rawPage()
    const observations = new Map<string, { id: string; changedFields: string[] }>([
      ['detail', { id: 'detail-observation-1', changedFields: ['rampType'] }],
    ])
    const listingObservationFindUnique = vi.fn().mockImplementation(
      ({ where }: { where: { stage_reference: { stage: string; reference: string } } }) =>
        Promise.resolve(observations.get(where.stage_reference.stage) ?? null),
    )
    const listingObservationUpsert = vi.fn().mockImplementation(
      ({ create }: { create: { stage: string; changedFields: string[] } }) => {
        observations.set(create.stage, { id: `${create.stage}-1`, changedFields: create.changedFields })
        return Promise.resolve({})
      },
    )
    const rawPageUpdate = vi.fn()
      .mockRejectedValueOnce(new Error('could not mark raw page processed'))
      .mockResolvedValueOnce({})
    const resolutionQueue = { add: vi.fn().mockResolvedValue('job-1') }
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn()
          .mockResolvedValueOnce([page])
          .mockResolvedValueOnce([page]),
        update: rawPageUpdate,
      },
      listingObservation: {
        findUnique: listingObservationFindUnique,
        upsert: listingObservationUpsert,
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser(), resolutionQueue as never)).rejects.toThrow(
      '[detail-extract] 1 of 1 raw page(s) failed extraction for source src-1 (0 succeeded)',
    )
    await expect(runDetailExtractJob('src-1', undefined, makeBrowser(), resolutionQueue as never)).resolves.toBeUndefined()

    expect(resolutionQueue.add).toHaveBeenCalledTimes(1)
    expect(listingObservationUpsert).toHaveBeenCalledTimes(1)
    expect(rawPageUpdate).toHaveBeenCalledTimes(2)
  })

  it('reports success and failure counts separately in job progress', async () => {
    const pages = [rawPage({ id: 'raw-1' }), rawPage({ id: 'raw-2', url: 'https://www.mobilityworks.com/listing/2' })]
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue(pages),
        update: vi.fn().mockResolvedValue({}),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail)
      .mockResolvedValueOnce(rawMwDetail())
      .mockRejectedValueOnce(new Error('boom'))

    const updateProgress = vi.fn().mockResolvedValue(undefined)
    const context = { log: vi.fn().mockResolvedValue(undefined), updateProgress }

    await expect(runDetailExtractJob('src-1', context, makeBrowser())).rejects.toThrow()

    const finalProgress = updateProgress.mock.calls.at(-1)?.[0]
    expect(finalProgress).toMatchObject({ stage: 'complete', success: 1, failed: 1 })
  })

  it('truncates a caught error before logging it, so a validation error embedding full listing data never reaches the logs (refs #637)', async () => {
    const leakySeller = 'Private seller notes: '.padEnd(50, 'x') + 'call John at 555-0100, address 123 Main St, prefers cash, will negotiate. '.repeat(10)
    const db = makeExtractDb({
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage()]),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockRejectedValue(new Error(`Invalid \`db.listing.update()\` invocation: { data: { description: "${leakySeller}" } }`)),
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    const log = vi.fn().mockResolvedValue(undefined)
    const context = { log, updateProgress: vi.fn().mockResolvedValue(undefined) }

    await expect(runDetailExtractJob('src-1', context, makeBrowser())).rejects.toThrow()

    const failureLog = log.mock.calls.map((call) => call[0] as string).find((message) => message.includes('Failed'))
    expect(failureLog).toBeDefined()
    expect(failureLog!.length).toBeLessThan(leakySeller.length)
    expect(failureLog).not.toContain('123 Main St')
  })
})

// ── Declarative extraction routing (#822) ────────────────────────────────────

describe('runDetailExtractJob — declarative extraction (#822)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(evaluateSourceListingDates).mockResolvedValue({
      sourceListedAt: null,
      sourceUpdatedAt: null,
    })
  })

  const colorMapping: FieldMapping = { targetField: 'color', selector: '.color', attribute: null, transform: 'trimText' }

  function makeDeclarativeDb(mappings: FieldMapping[], overrides: Record<string, unknown> = {}) {
    return makeExtractDb({
      source: {
        findUnique: vi.fn().mockResolvedValue({ status: 'active', errorMessage: null, mappings }),
      },
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage({ url: 'https://www.freedommotors.com/product/1' })]),
        update: vi.fn().mockResolvedValue({}),
      },
      ...overrides,
    })
  }

  it('routes a Freedom Motors URL through the declarative extractor when Source.mappings is configured', async () => {
    const db = makeDeclarativeDb([colorMapping])
    vi.mocked(getDb).mockReturnValue(db as never)
    const raw: RawDeclarativeDetail = { color: { values: ['Ebony Black'] } }
    vi.mocked(evaluateDeclarativeDetail).mockResolvedValue(raw)

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    expect(evaluateDeclarativeDetail).toHaveBeenCalledWith(expect.anything(), [colorMapping])
    expect(db.__tx.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ color: 'Ebony Black' }) }),
    )
  })

  it('reads Source.mappings fresh every run, so a setMappings write takes effect on the very next run with no code change (#822)', async () => {
    // Run 1: the source has an initial mapping targeting `.color`.
    const dbRun1 = makeDeclarativeDb([colorMapping])
    vi.mocked(getDb).mockReturnValue(dbRun1 as never)
    vi.mocked(evaluateDeclarativeDetail).mockResolvedValue({ color: { values: ['Ebony Black'] } })

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()
    expect(dbRun1.__tx.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ color: 'Ebony Black' }) }),
    )

    // Simulates the AI structure-remap loop calling setMappings (scraper-engine.ts)
    // between runs: a new, unrelated selector/transform for the very same
    // targetField, with zero changes to detail-extract.ts or declarative-detail.ts.
    const remappedMapping: FieldMapping = {
      targetField: 'color',
      selector: '.exterior-color-v2',
      attribute: null,
      transform: 'trimText',
    }
    vi.clearAllMocks()
    vi.mocked(evaluateSourceListingDates).mockResolvedValue({ sourceListedAt: null, sourceUpdatedAt: null })

    // Run 2: fresh job invocation reads the now-updated Source.mappings row.
    const dbRun2 = makeDeclarativeDb([remappedMapping])
    vi.mocked(getDb).mockReturnValue(dbRun2 as never)
    vi.mocked(evaluateDeclarativeDetail).mockResolvedValue({ color: { values: ['Snow White Pearl'] } })

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    expect(evaluateDeclarativeDetail).toHaveBeenCalledWith(expect.anything(), [remappedMapping])
    expect(dbRun2.__tx.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ color: 'Snow White Pearl' }) }),
    )
  })

  it('does not fabricate a value and preserves the existing listing field when the declarative selector matches nothing', async () => {
    const db = makeDeclarativeDb([colorMapping], {
      listing: {
        findFirst: vi.fn().mockResolvedValue(baseListingRow({ color: 'Previously Observed Silver' })),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateDeclarativeDetail).mockResolvedValue({ color: { values: [] } })

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    const updateCall = db.__tx.listing.update.mock.calls.at(0)?.[0] as { data: Record<string, unknown> } | undefined
    expect(updateCall?.data.color).toBeUndefined()
  })

  it('falls back to no extraction (no fabricated values) for a URL with no bespoke parser and no configured mappings', async () => {
    const db = makeExtractDb({
      source: {
        findUnique: vi.fn().mockResolvedValue({ status: 'active', errorMessage: null, mappings: [] }),
      },
      rawPage: {
        findMany: vi.fn().mockResolvedValue([rawPage({ url: 'https://www.example-unmapped-source.com/listing/1' })]),
        update: vi.fn().mockResolvedValue({}),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()

    expect(evaluateDeclarativeDetail).not.toHaveBeenCalled()
    expect(evaluateMwDetail).not.toHaveBeenCalled()
  })
})

describe('summarizeError', () => {
  it('uses the Error message, not the full stack or object dump', () => {
    expect(summarizeError(new Error('boom'))).toBe('boom')
  })

  it('collapses embedded whitespace and newlines', () => {
    expect(summarizeError(new Error('line one\n  line two\n\tline three'))).toBe('line one line two line three')
  })

  it('truncates long messages with an ellipsis', () => {
    const long = 'x'.repeat(500)
    const result = summarizeError(new Error(long))
    expect(result.length).toBeLessThan(long.length)
    expect(result.endsWith('…')).toBe(true)
  })

  it('stringifies non-Error throwables', () => {
    expect(summarizeError('plain string failure')).toBe('plain string failure')
  })

  it('cuts a Prisma-style argument dump at its opening brace, dropping listing content entirely (refs #637)', () => {
    const message = 'Invalid `db.listing.update()` invocation: { data: { description: "Private seller notes: call John at 555-0100, address 123 Main St" } }'
    const result = summarizeError(new Error(message))
    expect(result).toBe('Invalid `db.listing.update()` invocation:')
    expect(result).not.toContain('123 Main St')
    expect(result).not.toContain('description')
  })

  it('falls back to a placeholder when the message is empty or brace-only', () => {
    expect(summarizeError(new Error(''))).toBe('error (no message)')
    expect(summarizeError(new Error('{ raw: true }'))).toBe('error (no message)')
  })
})

describe('blvdEvidence', () => {
  const baseRaw: RawDetail = {
    specs: { Color: 'Grey', Engine: '2.5L Hybrid I4', Transmission: 'automatic' },
    descriptionText: 'Rear Entry, Manual, Fold Out ramp.',
    imageUrls: [],
    dealerPhone: '',
    dealerAddressText: '',
    statusBannerText: '',
  }

  // refs #632: galleryFound distinguishes "gallery container not found" from
  // "verified empty gallery" so a missing selector never overwrites a
  // previously observed image set.

  it('reports images as missing when the gallery container was never located', () => {
    const raw: RawDetail = { ...baseRaw, galleryFound: false, imageUrls: [] }
    expect(blvdEvidence(raw).images).toBe('missing')
  })

  it('reports images as missing when galleryFound is absent (legacy raw shape)', () => {
    const raw: RawDetail = { ...baseRaw, imageUrls: [] }
    expect(blvdEvidence(raw).images).toBe('missing')
  })

  it('reports images as authoritative_empty when a gallery container was found but held no images', () => {
    const raw: RawDetail = { ...baseRaw, galleryFound: true, imageUrls: [] }
    expect(blvdEvidence(raw).images).toBe('authoritative_empty')
  })

  it('reports images as value when a gallery container was found with images', () => {
    const raw: RawDetail = {
      ...baseRaw,
      galleryFound: true,
      imageUrls: ['https://www.blvd.com/van_1_large.jpg'],
    }
    expect(blvdEvidence(raw).images).toBe('value')
  })

  it('derives color/engine/transmission/description evidence from specs and description text', () => {
    const raw: RawDetail = { ...baseRaw, galleryFound: true, imageUrls: [] }
    const evidence = blvdEvidence(raw)
    expect(evidence.color).toBe('value')
    expect(evidence.engine).toBe('value')
    expect(evidence.transmission).toBe('value')
    expect(evidence.description).toBe('value')
    expect(evidence.fuelType).toBe('missing')
  })

  it('reports description and spec evidence as missing when absent', () => {
    const raw: RawDetail = {
      specs: {},
      descriptionText: '',
      imageUrls: [],
      galleryFound: false,
      dealerPhone: '',
      dealerAddressText: '',
      statusBannerText: '',
    }
    const evidence = blvdEvidence(raw)
    expect(evidence.color).toBe('missing')
    expect(evidence.engine).toBe('missing')
    expect(evidence.transmission).toBe('missing')
    expect(evidence.description).toBe('missing')
  })
})

describe('resolveListingStatus', () => {
  // ── possibly_gone listings ───────────────────────────────────────────────

  it('marks gone + sets soldAt when possibly_gone listing has sold banner (first time)', () => {
    const result = resolveListingStatus('possibly_gone', 'sold', null, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW, soldAt: NOW })
  })

  it('marks gone without soldAt when possibly_gone listing has unavailable banner', () => {
    const result = resolveListingStatus('possibly_gone', 'gone', null, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW })
  })

  it('marks gone without overwriting existing soldAt when possibly_gone listing has sold banner', () => {
    const existingSoldAt = new Date('2026-01-01')
    const result = resolveListingStatus('possibly_gone', 'sold', existingSoldAt, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW })
    expect(result).not.toHaveProperty('soldAt')
  })

  it('restores to active when possibly_gone listing has pending banner (still live, under contract)', () => {
    const result = resolveListingStatus('possibly_gone', 'pending', null, NOW)
    expect(result).toEqual({ status: 'active', goneAt: null })
  })

  it('restores to active when possibly_gone listing has no banner', () => {
    const result = resolveListingStatus('possibly_gone', 'active', null, NOW)
    expect(result).toEqual({ status: 'active', goneAt: null })
  })

  // ── active listings (stale refresh) ─────────────────────────────────────

  it('marks gone + sets soldAt when active listing has sold banner (first time)', () => {
    const result = resolveListingStatus('active', 'sold', null, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW, soldAt: NOW })
  })

  it('marks gone without soldAt when active listing has unavailable banner', () => {
    const result = resolveListingStatus('active', 'gone', null, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW })
  })

  it('marks gone without overwriting existing soldAt when active listing has sold banner', () => {
    const existingSoldAt = new Date('2026-01-15')
    const result = resolveListingStatus('active', 'sold', existingSoldAt, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW })
    expect(result).not.toHaveProperty('soldAt')
  })

  it('makes no status change when active listing has pending banner (stays visible in search)', () => {
    const result = resolveListingStatus('active', 'pending', null, NOW)
    expect(result).toEqual({})
  })

  it('makes no status change when active listing has no banner (normal stale refresh)', () => {
    const result = resolveListingStatus('active', 'active', null, NOW)
    expect(result).toEqual({})
  })

  // ── already gone listings (defensive) ───────────────────────────────────

  it('makes no status change when already-gone listing is re-processed', () => {
    expect(resolveListingStatus('gone', 'sold', null, NOW)).toEqual({})
    expect(resolveListingStatus('gone', 'gone', null, NOW)).toEqual({})
    expect(resolveListingStatus('gone', 'pending', null, NOW)).toEqual({})
    expect(resolveListingStatus('gone', 'active', null, NOW)).toEqual({})
  })

  // ── index-absent possibly_gone listings (missingFromCompleteCount > 0) ───

  it('does NOT restore to active when possibly_gone is index-absent (missingFromCompleteCount=1) with no banner', () => {
    const result = resolveListingStatus('possibly_gone', 'active', null, NOW, 1)
    expect(result).toEqual({})
  })

  it('does NOT restore to active when possibly_gone is index-absent with pending banner', () => {
    const result = resolveListingStatus('possibly_gone', 'pending', null, NOW, 2)
    expect(result).toEqual({})
  })

  it('still marks gone when index-absent possibly_gone listing has sold banner', () => {
    const result = resolveListingStatus('possibly_gone', 'sold', null, NOW, 1)
    expect(result).toEqual({ status: 'gone', goneAt: NOW, soldAt: NOW })
  })

  it('still marks gone when index-absent possibly_gone listing has unavailable banner', () => {
    const result = resolveListingStatus('possibly_gone', 'gone', null, NOW, 3)
    expect(result).toEqual({ status: 'gone', goneAt: NOW })
  })

  it('restores to active when possibly_gone has no index-absence evidence (count=0) with no banner', () => {
    // Ensures backward compat: old possibly_gone rows without the count default to 0 and restore
    const result = resolveListingStatus('possibly_gone', 'active', null, NOW, 0)
    expect(result).toEqual({ status: 'active', goneAt: null })
  })

  it('restores to active when possibly_gone has no index-absence evidence (default) with pending banner', () => {
    const result = resolveListingStatus('possibly_gone', 'pending', null, NOW)
    expect(result).toEqual({ status: 'active', goneAt: null })
  })

  // ── orphan detail page (200 + no banner, absent from source index) ───────

  it('does not restore a 200 orphan detail page listing when it is index-absent', () => {
    // Simulates: listing removed from dealer inventory, detail URL returns 200,
    // no sold/pending banner — the 200 must NOT restore active status
    const result = resolveListingStatus('possibly_gone', 'active', null, NOW, 1)
    expect(result).toEqual({})
  })
})

describe('buildListingDetailUpdateData', () => {
  const detail = {
    color: 'Grey',
    // BLVD: fuelType is null; engine holds the raw engine description
    fuelType: null,
    engine: '2.5L Hybrid I4',
    transmission: 'automatic',
    rampType: 'fold_out' as const,
    conversionType: 'rear_entry' as const,
    wavFeatures: ['transfer_seat' as const],
    floorLoweringInches: 14,
    wheelchairCapacity: null,
    description: 'Rear Entry wheelchair van.',
    images: ['https://www.blvd.com/van_large.jpg'],
    zip: '95815',
    dealerPhone: '(916) 555-0101',
    saleStatus: 'active' as const,
    sourceListedAt: null,
    sourceUpdatedAt: null,
    evidence: {
      color: 'value' as const,
      fuelType: 'value' as const,
      engine: 'value' as const,
      transmission: 'value' as const,
      description: 'value' as const,
      images: 'value' as const,
      accessibilityClaims: 'value' as const,
    },
  }

  it('includes dealer phone, dealer website, and direct buyer URL when enrichment succeeds', () => {
    expect(buildListingDetailUpdateData(detail, {
      dealerWebsite: 'https://dealer.example.com',
      directVehicleUrl: 'https://dealer.example.com/inventory/5TDYRKEC8RS205440',
    }, {}, NOW)).toMatchObject({
      dealerPhone: '(916) 555-0101',
      dealerWebsite: 'https://dealer.example.com',
      buyerUrl: 'https://dealer.example.com/inventory/5TDYRKEC8RS205440',
      detailScrapedAt: NOW,
      publicationStatus: 'pending',
      qualityIssueCodes: [],
      qualityCheckedAt: null,
    })
  })

  it('includes source-provided dates when present', () => {
    const sourceListedAt = new Date('2026-05-01T00:00:00Z')
    const sourceUpdatedAt = new Date('2026-05-03T00:00:00Z')
    const result = buildListingDetailUpdateData({
      ...detail,
      sourceListedAt,
      sourceUpdatedAt,
    }, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)

    expect(result).toMatchObject({ sourceListedAt, sourceUpdatedAt })
  })

  it('omits unavailable source dates so existing values are preserved', () => {
    const result = buildListingDetailUpdateData(
      detail,
      { dealerWebsite: null, directVehicleUrl: null },
      {},
      NOW,
    )

    expect(result).not.toHaveProperty('sourceListedAt')
    expect(result).not.toHaveProperty('sourceUpdatedAt')
  })

  it('omits buyerUrl when enrichment falls back to the existing BLVD URL', () => {
    expect(buildListingDetailUpdateData(detail, {
      dealerWebsite: 'https://dealer.example.com',
      directVehicleUrl: null,
    }, {}, NOW)).not.toHaveProperty('buyerUrl')
  })

  it('includes description when detail.description is non-null', () => {
    const result = buildListingDetailUpdateData(detail, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).toHaveProperty('description', 'Rear Entry wheelchair van.')
  })

  it('omits description key when extraction has no description evidence', () => {
    const noDesc = {
      ...detail,
      description: null,
      evidence: { ...detail.evidence, description: 'missing' as const },
    }
    const result = buildListingDetailUpdateData(noDesc, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).not.toHaveProperty('description')
  })

  it('omits images key when gallery extraction has no evidence', () => {
    const noImages = {
      ...detail,
      images: [],
      evidence: { ...detail.evidence, images: 'missing' as const },
    }
    const result = buildListingDetailUpdateData(noImages, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).not.toHaveProperty('images')
  })

  it('clears images when a verified gallery is authoritatively empty', () => {
    const emptyGallery = {
      ...detail,
      images: [],
      evidence: { ...detail.evidence, images: 'authoritative_empty' as const },
    }
    const result = buildListingDetailUpdateData(emptyGallery, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).toHaveProperty('images', [])
  })

  it('clears description and accessibility fields when the bounded section is authoritatively empty', () => {
    const emptyDescription = {
      ...detail,
      description: null,
      rampType: 'unknown' as const,
      wavFeatures: [],
      evidence: { ...detail.evidence, description: 'authoritative_empty' as const },
    }
    const result = buildListingDetailUpdateData(emptyDescription, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).toMatchObject({ description: null, rampType: 'unknown', wavFeatures: [] })
  })

  it('includes images key when detail.images has entries', () => {
    const result = buildListingDetailUpdateData(detail, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).toHaveProperty('images')
  })

  it('passes engine field through when non-null (refs #515)', () => {
    const withEngine = { ...detail, engine: '3.5L V6 DOHC' }
    const result = buildListingDetailUpdateData(withEngine, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).toHaveProperty('engine', '3.5L V6 DOHC')
  })

  it('omits engine key when engine is null (preserves previous DB value)', () => {
    const noEngine = {
      ...detail,
      engine: null,
      evidence: { ...detail.evidence, engine: 'missing' as const },
    }
    const result = buildListingDetailUpdateData(noEngine, { dealerWebsite: null, directVehicleUrl: null }, {}, NOW)
    expect(result).not.toHaveProperty('engine')
  })

  it('preserves an unobserved spec field when another spec succeeded', () => {
    const partialSpecs = {
      ...detail,
      color: null,
      evidence: { ...detail.evidence, color: 'missing' as const },
    }

    expect(buildListingDetailUpdateData(
      partialSpecs,
      { dealerWebsite: null, directVehicleUrl: null },
      {},
      NOW,
    )).not.toHaveProperty('color')
  })
})

describe('changedDetailFields', () => {
  it('does not treat scrape bookkeeping as a content change', () => {
    expect(changedDetailFields(
      { color: 'Grey', detailScrapedAt: new Date('2026-06-01') },
      { color: 'Grey', detailScrapedAt: NOW, publicationStatus: 'pending' },
    )).toEqual([])
  })

  it('detects changed galleries and authoritative field clearing', () => {
    expect(changedDetailFields(
      { images: ['stale.jpg'], description: 'stale' },
      { images: [], description: null },
    )).toEqual(['images', 'description'])
  })
})

describe('detail observation retry keys and resolution handoff', () => {
  it('uses the raw-page observation time so a later recrawl is processed', () => {
    const first = detailObservationReference({ id: 'raw-1', scrapedAt: new Date('2026-06-01') })
    const second = detailObservationReference({ id: 'raw-1', scrapedAt: new Date('2026-06-02') })

    expect(first).not.toBe(second)
  })

  it('enqueues resolution only for accessibility-critical changes', () => {
    expect(requiresListingResolution(['priceCents', 'wavFeatures'])).toBe(true)
    expect(requiresListingResolution(['priceCents', 'images'])).toBe(false)
  })

})
