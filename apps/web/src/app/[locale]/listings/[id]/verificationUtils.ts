import type { ListingProvenance } from './types'

/** Number of hours after which a listing is considered stale. */
export const STALE_THRESHOLD_HOURS = 12

/**
 * Returns the best available verification timestamp from provenance.
 * Prefers `detailScrapedAt` (most recent re-verification) over `scrapedAt`
 * (initial discovery). Returns null when provenance is unavailable.
 *
 * Note: `scrapedAt` is non-nullable per schema and type contract, so the
 * fallback to `provenance.scrapedAt` will always resolve when provenance is
 * present. The expression is written defensively to ensure null-safety at
 * the UI boundary.
 */
export function getVerificationTimestamp(
  provenance: ListingProvenance | null | undefined,
): string | null {
  if (provenance == null) return null
  return provenance.detailScrapedAt ?? provenance.scrapedAt
}

/**
 * Returns true when the given ISO-8601 timestamp is older than STALE_THRESHOLD_HOURS.
 * Returns false when timestamp is null — missing timestamps are handled
 * separately as a "unavailable" case, not a "stale" case.
 */
export function isVerificationStale(
  timestamp: string | null,
  thresholdHours: number = STALE_THRESHOLD_HOURS,
): boolean {
  if (timestamp === null) return false
  const ageMs = Date.now() - new Date(timestamp).getTime()
  const ageHours = ageMs / 3_600_000
  return ageHours > thresholdHours
}

/**
 * Formats a verification timestamp as a compact relative age.
 * Returns null when timestamp is null (caller must show a fallback).
 */
export function formatVerificationDate(timestamp: string | null): string | null {
  if (timestamp === null) return null

  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000))
  const ageMinutes = Math.round(ageSeconds / 60)
  const ageHours = Math.round(ageMinutes / 60)
  const ageDays = Math.round(ageHours / 24)

  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (ageSeconds < 60) return formatter.format(-ageSeconds, 'second')
  if (ageMinutes < 60) return formatter.format(-ageMinutes, 'minute')
  if (ageHours < 48) return formatter.format(-ageHours, 'hour')
  return formatter.format(-ageDays, 'day')
}
