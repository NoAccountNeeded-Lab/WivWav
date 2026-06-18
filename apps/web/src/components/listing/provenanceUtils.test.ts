import { describe, it, expect } from 'vitest'
import type { ListingProvenance } from '@/app/listings/[id]/types'
import {
  hasFullProvenance,
  hasProvenanceLink,
  resolveProvenanceHref,
} from './provenanceUtils.js'

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeProvenance(overrides: Partial<ListingProvenance> = {}): ListingProvenance {
  return {
    sourceName: 'Ability Center',
    sourceBaseUrl: 'abilitycenter.com',
    sourceUrl: 'https://abilitycenter.com/listings/123',
    buyerUrl: 'https://abilitycenter.com/listings/123?ref=wavsearch',
    scrapedAt: '2026-06-01T00:00:00.000Z',
    detailScrapedAt: '2026-06-01T01:00:00.000Z',
    vehicleModelMatchConfidence: 'high',
    ...overrides,
  }
}

// ── hasFullProvenance ─────────────────────────────────────────────────────────

describe('hasFullProvenance', () => {
  it('returns true for a complete provenance object', () => {
    expect(hasFullProvenance(makeProvenance())).toBe(true)
  })

  it('returns false when provenance is null', () => {
    expect(hasFullProvenance(null)).toBe(false)
  })

  it('returns false when provenance is undefined', () => {
    expect(hasFullProvenance(undefined)).toBe(false)
  })

  it('returns false when sourceName is an empty string', () => {
    expect(hasFullProvenance(makeProvenance({ sourceName: '' }))).toBe(false)
  })

  it('returns false when sourceName is only whitespace', () => {
    expect(hasFullProvenance(makeProvenance({ sourceName: '   ' }))).toBe(false)
  })

  it('returns true when optional fields are null', () => {
    expect(
      hasFullProvenance(
        makeProvenance({ buyerUrl: null, detailScrapedAt: null, vehicleModelMatchConfidence: null }),
      ),
    ).toBe(true)
  })
})

// ── hasProvenanceLink ─────────────────────────────────────────────────────────

describe('hasProvenanceLink', () => {
  it('returns true when buyerUrl is present', () => {
    expect(hasProvenanceLink(makeProvenance())).toBe(true)
  })

  it('returns true when only sourceUrl is present (no buyerUrl)', () => {
    expect(hasProvenanceLink(makeProvenance({ buyerUrl: null }))).toBe(true)
  })

  it('returns false when provenance is null', () => {
    expect(hasProvenanceLink(null)).toBe(false)
  })

  it('returns false when provenance is undefined', () => {
    expect(hasProvenanceLink(undefined)).toBe(false)
  })

  it('returns false when both buyerUrl and sourceUrl are falsy', () => {
    // TypeScript guards against this at the interface level, but cast to test
    const p = makeProvenance({ buyerUrl: null, sourceUrl: '' })
    expect(hasProvenanceLink(p)).toBe(false)
  })

  it('returns false when the URL has a non-http scheme', () => {
    const p = makeProvenance({ buyerUrl: null, sourceUrl: 'javascript:void(0)' })
    expect(hasProvenanceLink(p)).toBe(false)
  })
})

// ── resolveProvenanceHref ─────────────────────────────────────────────────────

describe('resolveProvenanceHref', () => {
  it('returns buyerUrl when present', () => {
    const p = makeProvenance({
      buyerUrl: 'https://abilitycenter.com/listings/123?ref=wavsearch',
      sourceUrl: 'https://abilitycenter.com/listings/123',
    })
    expect(resolveProvenanceHref(p)).toBe('https://abilitycenter.com/listings/123?ref=wavsearch')
  })

  it('falls back to sourceUrl when buyerUrl is null', () => {
    const p = makeProvenance({
      buyerUrl: null,
      sourceUrl: 'https://abilitycenter.com/listings/123',
    })
    expect(resolveProvenanceHref(p)).toBe('https://abilitycenter.com/listings/123')
  })

  it('returns null when provenance is null', () => {
    expect(resolveProvenanceHref(null)).toBeNull()
  })

  it('returns null when provenance is undefined', () => {
    expect(resolveProvenanceHref(undefined)).toBeNull()
  })

  it('returns null when the URL has a non-http scheme', () => {
    const p = makeProvenance({ buyerUrl: null, sourceUrl: 'javascript:void(0)' })
    expect(resolveProvenanceHref(p)).toBeNull()
  })

  it('returns null when buyerUrl has a non-http scheme (sourceUrl not used as fallback)', () => {
    const p = makeProvenance({
      buyerUrl: 'data:text/html,<b>hi</b>',
      sourceUrl: 'https://abilitycenter.com/listings/123',
    })
    // buyerUrl takes priority; it is unsafe → result is null even though sourceUrl is safe
    expect(resolveProvenanceHref(p)).toBeNull()
  })
})
