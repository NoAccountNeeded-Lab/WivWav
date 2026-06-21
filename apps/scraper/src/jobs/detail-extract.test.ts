import { describe, it, expect } from 'vitest'
import { buildListingDetailUpdateData, resolveListingStatus } from './detail-extract.js'

const NOW = new Date('2026-06-02T00:00:00Z')

describe('resolveListingStatus', () => {
  // ── possibly_gone listings ───────────────────────────────────────────────

  it('marks gone + sets soldAt when possibly_gone listing has sold banner (first time)', () => {
    const result = resolveListingStatus('possibly_gone', 'sold', null, NOW)
    expect(result).toEqual({ status: 'gone', goneAt: NOW, soldAt: NOW })
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
    expect(resolveListingStatus('gone', 'pending', null, NOW)).toEqual({})
    expect(resolveListingStatus('gone', 'active', null, NOW)).toEqual({})
  })
})

describe('buildListingDetailUpdateData', () => {
  const detail = {
    color: 'Grey',
    fuelType: '2.5L Hybrid I4',
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
    })
  })

  it('omits buyerUrl when enrichment falls back to the existing BLVD URL', () => {
    expect(buildListingDetailUpdateData(detail, {
      dealerWebsite: 'https://dealer.example.com',
      directVehicleUrl: null,
    }, {}, NOW)).not.toHaveProperty('buyerUrl')
  })
})
