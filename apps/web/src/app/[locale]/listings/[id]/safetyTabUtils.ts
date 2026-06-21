/** Number of days after which safety data is considered stale. */
const STALE_THRESHOLD_DAYS = 90

/**
 * Returns true when the given ISO-8601 freshness date is older than STALE_THRESHOLD_DAYS.
 * Returns false (not stale) when the date is null — the absence of a date is handled
 * separately as a "missing freshness" case, not a "stale" case.
 */
export function isSafetyDataStale(freshnessDate: string | null): boolean {
  if (freshnessDate === null) return false
  const ageMs = Date.now() - new Date(freshnessDate).getTime()
  const ageDays = ageMs / 86_400_000
  return ageDays > STALE_THRESHOLD_DAYS
}

/**
 * Formats the freshness date for display.
 * Returns null when freshnessDate is null (caller must show a fallback).
 */
export function formatFreshnessDate(freshnessDate: string | null): string | null {
  if (freshnessDate === null) return null
  return new Date(freshnessDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Returns a human-readable label for a recall status.
 * Handles all three cases: open, remedied, and unknown.
 */
export function recallStatusLabel(status: 'open' | 'remedied' | 'unknown'): string {
  if (status === 'open') return 'Remedy open — schedule service'
  if (status === 'remedied') return 'Remedy available — completed'
  return 'Status unknown'
}
