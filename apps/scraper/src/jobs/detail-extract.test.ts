import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))
vi.mock('../sources/mobilityworks-detail.js', async () => {
  const actual = await vi.importActual<typeof import('../sources/mobilityworks-detail.js')>(
    '../sources/mobilityworks-detail.js',
  )
  // Only evaluateMwDetail touches the (unavailable, in this unit test) DOM;
  // parseMwDetail is a pure function over its raw output and runs for real.
  return {
    ...actual,
    evaluateMwDetail: vi.fn(),
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
  return {
    rawPage: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    listing: {
      findFirst: vi.fn().mockResolvedValue(baseListingRow()),
    },
    listingObservation: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => fn(tx)),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    __tx: tx,
    ...overrides,
  }
}

function makeBrowser(pages: Map<string, MockPageRecord> = new Map()) {
  return new MockBrowserService(pages)
}

describe('runDetailExtractJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an empty source id before querying the database', async () => {
    await expect(runDetailExtractJob('   ')).rejects.toThrow(
      '[detail-extract] sourceId must be a non-empty string',
    )
    expect(getDb).not.toHaveBeenCalled()
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
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(evaluateMwDetail).mockResolvedValue(rawMwDetail())

    await expect(runDetailExtractJob('src-1', undefined, makeBrowser())).resolves.toBeUndefined()
    expect(db.rawPage.update).toHaveBeenCalledWith({
      where: { id: 'raw-1' },
      data: { processedAt: expect.any(Date) },
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
        findUnique: vi.fn().mockResolvedValue({ id: 'observation-1' }),
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
    wavFeatures: ['transfer_seat' as const],
    floorLoweringInches: 14,
    wheelchairCapacity: null,
    description: 'Rear Entry wheelchair van.',
    images: ['https://www.blvd.com/van_large.jpg'],
    zip: '95815',
    dealerPhone: '(916) 555-0101',
    saleStatus: 'active' as const,
    evidence: {
      color: 'value' as const,
      fuelType: 'value' as const,
      engine: 'value' as const,
      transmission: 'value' as const,
      description: 'value' as const,
      images: 'value' as const,
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
