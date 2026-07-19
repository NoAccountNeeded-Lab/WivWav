// SafetyTab.tsx is a React Server Component and cannot be imported directly in Vitest.
// All pure derivation logic is extracted into safetyTabUtils.ts and tested here in isolation,
// following the same pattern as VehicleTab.test.ts.

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { isSafetyDataStale, formatFreshnessDate, recallStatusLabel } from './safetyTabUtils.js'

// ── isSafetyDataStale ─────────────────────────────────────────────────────────

describe('isSafetyDataStale', () => {
  beforeEach(() => {
    // Pin Date.now() to 2026-06-18
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-18T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when freshnessDate is null (missing data is not stale)', () => {
    expect(isSafetyDataStale(null)).toBe(false)
  })

  it('returns false when data is within 90 days', () => {
    // 30 days ago
    expect(isSafetyDataStale('2026-05-19T00:00:00.000Z')).toBe(false)
  })

  it('returns false when data is exactly 90 days old', () => {
    // exactly 90 days ago = boundary, not stale (> 90)
    expect(isSafetyDataStale('2026-03-20T00:00:00.000Z')).toBe(false)
  })

  it('returns true when data is older than 90 days', () => {
    // 91 days ago
    expect(isSafetyDataStale('2026-03-19T00:00:00.000Z')).toBe(true)
  })

  it('returns true for very old data (e.g. 2 years ago)', () => {
    expect(isSafetyDataStale('2024-06-18T00:00:00.000Z')).toBe(true)
  })
})

// ── formatFreshnessDate ───────────────────────────────────────────────────────

describe('formatFreshnessDate', () => {
  it('returns null when freshnessDate is null', () => {
    expect(formatFreshnessDate(null)).toBeNull()
  })

  it('returns a human-readable date string for a valid ISO date', () => {
    const result = formatFreshnessDate('2026-05-01T00:00:00.000Z')
    // Should contain year, month name, and day
    expect(result).toMatch(/2026/)
    expect(result).toMatch(/May|April/) // timezone-dependent, both acceptable
    expect(typeof result).toBe('string')
  })

  it('returns a non-empty string for any valid date', () => {
    const result = formatFreshnessDate('2024-01-15T12:00:00.000Z')
    expect(result).not.toBeNull()
    expect((result as string).length).toBeGreaterThan(0)
  })
})

// ── recallStatusLabel ─────────────────────────────────────────────────────────

describe('recallStatusLabel', () => {
  it('returns open remedy label for open status', () => {
    expect(recallStatusLabel('open')).toBe('Remedy open — schedule service')
  })

  it('returns remedied label for remedied status', () => {
    expect(recallStatusLabel('remedied')).toBe('Fix procedure published')
  })

  it('returns status unknown label when status is unknown', () => {
    expect(recallStatusLabel('unknown')).toBe('Fix not yet available')
  })
})
