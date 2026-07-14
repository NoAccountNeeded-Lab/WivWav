import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import {
  buildListingDetailUpdateData,
  blvdEvidence,
  changedDetailFields,
  detailObservationReference,
  requiresListingResolution,
  resolveListingStatus,
} from './detail-extract.js'
import { runDetailExtractJob } from './detail-extract.js'
import type { RawDetail } from '../sources/blvd-detail.js'

const NOW = new Date('2026-06-02T00:00:00Z')

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
