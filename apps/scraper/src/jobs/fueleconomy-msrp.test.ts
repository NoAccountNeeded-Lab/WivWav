import { describe, it, expect } from 'vitest'

// ── Unit tests for pure helpers extracted from fueleconomy-msrp.ts ────────────
// The job module uses getDb() and external fetch, so we test pure derivation
// logic here in isolation, mirroring the pattern used in nhtsa-safety-ratings
// and other job test files.

/**
 * parseMsrpToCents — extracted for testing; keep in sync with the implementation.
 */
function parseMsrpToCents(raw: number | string | null | undefined): number | null {
  if (raw == null) return null
  const numeric =
    typeof raw === 'number'
      ? raw
      : parseFloat(String(raw).replace(/[$,]/g, ''))
  if (!isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric * 100)
}

describe('parseMsrpToCents', () => {
  it('returns null for null input', () => {
    expect(parseMsrpToCents(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseMsrpToCents(undefined)).toBeNull()
  })

  it('returns null for zero', () => {
    expect(parseMsrpToCents(0)).toBeNull()
  })

  it('returns null for negative number', () => {
    expect(parseMsrpToCents(-100)).toBeNull()
  })

  it('converts a plain number to cents', () => {
    expect(parseMsrpToCents(29990)).toBe(2999000)
  })

  it('converts a string dollar amount with $ and commas', () => {
    expect(parseMsrpToCents('$29,990')).toBe(2999000)
  })

  it('converts a decimal number to rounded cents', () => {
    expect(parseMsrpToCents(29990.5)).toBe(2999050)
  })

  it('returns null for non-numeric string', () => {
    expect(parseMsrpToCents('N/A')).toBeNull()
  })

  it('handles large MSRP values', () => {
    expect(parseMsrpToCents(150000)).toBe(15000000)
  })
})

// ── bestMsrpCents selection logic ─────────────────────────────────────────────
// The job picks the lowest non-null MSRP across variants.

function pickBestMsrp(candidates: (number | null)[]): number | null {
  let best: number | null = null
  for (const c of candidates) {
    if (c !== null && (best === null || c < best)) best = c
  }
  return best
}

describe('pickBestMsrp', () => {
  it('returns null when all candidates are null', () => {
    expect(pickBestMsrp([null, null])).toBeNull()
  })

  it('returns the single non-null candidate', () => {
    expect(pickBestMsrp([null, 2999000, null])).toBe(2999000)
  })

  it('returns the lowest value from multiple candidates', () => {
    expect(pickBestMsrp([3500000, 2999000, 4200000])).toBe(2999000)
  })

  it('returns null for an empty candidates list', () => {
    expect(pickBestMsrp([])).toBeNull()
  })
})
