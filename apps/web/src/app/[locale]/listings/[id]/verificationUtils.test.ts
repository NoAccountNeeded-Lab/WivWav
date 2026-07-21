// OverviewTab is a React Server Component and cannot be imported directly in Vitest.
// Pure derivation logic is extracted into verificationUtils.ts and tested here in isolation,
// following the same pattern as SafetyTab.test.ts.

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import {
  getVerificationTimestamp,
  isVerificationStale,
  formatVerificationDate,
  STALE_THRESHOLD_HOURS,
} from './verificationUtils.js'
import type { ListingProvenance } from './types.js'

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeProvenance(
  overrides: Partial<ListingProvenance> = {},
): ListingProvenance {
  return {
    sourceName: 'TestSource',
    sourceBaseUrl: 'https://test.example',
    sourceUrl: 'https://test.example/listing/1',
    buyerUrl: null,
    scrapedAt: '2026-06-18T00:00:00.000Z',
    detailScrapedAt: null,
    vehicleModelMatchConfidence: null,
    ...overrides,
  }
}

// ── getVerificationTimestamp ───────────────────────────────────────────────

describe('getVerificationTimestamp', () => {
  it('returns null when provenance is null', () => {
    expect(getVerificationTimestamp(null)).toBeNull()
  })

  it('returns null when provenance is undefined', () => {
    expect(getVerificationTimestamp(undefined)).toBeNull()
  })

  it('returns detailScrapedAt when present (preferred over scrapedAt)', () => {
    const provenance = makeProvenance({
      scrapedAt: '2026-06-01T00:00:00.000Z',
      detailScrapedAt: '2026-06-18T10:00:00.000Z',
    })
    expect(getVerificationTimestamp(provenance)).toBe('2026-06-18T10:00:00.000Z')
  })

  it('falls back to scrapedAt when detailScrapedAt is null', () => {
    const provenance = makeProvenance({
      scrapedAt: '2026-06-17T08:00:00.000Z',
      detailScrapedAt: null,
    })
    expect(getVerificationTimestamp(provenance)).toBe('2026-06-17T08:00:00.000Z')
  })

  it('returns scrapedAt when detailScrapedAt is null (scrapedAt is always present per schema)', () => {
    const provenance = makeProvenance({
      scrapedAt: '2026-06-15T06:00:00.000Z',
      detailScrapedAt: null,
    })
    expect(getVerificationTimestamp(provenance)).toBe('2026-06-15T06:00:00.000Z')
  })
})

// ── isVerificationStale ────────────────────────────────────────────────────

describe('isVerificationStale', () => {
  beforeEach(() => {
    // Pin Date.now() to 2026-06-18T12:00:00Z
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-18T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when timestamp is null (missing is not stale)', () => {
    expect(isVerificationStale(null)).toBe(false)
  })

  it('returns false when listing was verified recently (1 hour ago)', () => {
    expect(isVerificationStale('2026-06-18T11:00:00.000Z')).toBe(false)
  })

  it(`returns false when listing is exactly ${STALE_THRESHOLD_HOURS} hours old (boundary — not stale)`, () => {
    // Exactly 12 hours ago: not stale (> threshold required)
    expect(isVerificationStale('2026-06-18T00:00:00.000Z')).toBe(false)
  })

  it(`returns true when listing is older than ${STALE_THRESHOLD_HOURS} hours`, () => {
    // 13 hours ago
    expect(isVerificationStale('2026-06-17T23:00:00.000Z')).toBe(true)
  })

  it('returns true for very old data (several days ago)', () => {
    expect(isVerificationStale('2026-06-10T00:00:00.000Z')).toBe(true)
  })

  it('respects a custom threshold', () => {
    // 5 hours ago — stale at 3h threshold but not at 12h
    expect(isVerificationStale('2026-06-18T07:00:00.000Z', 3)).toBe(true)
    expect(isVerificationStale('2026-06-18T07:00:00.000Z', 12)).toBe(false)
  })
})

// ── formatVerificationDate ─────────────────────────────────────────────────

describe('formatVerificationDate', () => {
  it('returns null when timestamp is null', () => {
    expect(formatVerificationDate(null)).toBeNull()
  })

  it('returns a human-readable date string for a valid ISO timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-18T13:30:00.000Z'))

    const result = formatVerificationDate('2026-06-18T10:30:00.000Z')
    expect(result).toBe('3 hours ago')

    vi.useRealTimers()
  })

  it('returns a non-empty string for any valid date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-16T12:00:00.000Z'))

    const result = formatVerificationDate('2024-01-15T12:00:00.000Z')
    expect(result).not.toBeNull()
    expect((result as string).length).toBeGreaterThan(0)

    vi.useRealTimers()
  })
})
