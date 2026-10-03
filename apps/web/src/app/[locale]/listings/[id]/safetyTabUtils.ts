import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'

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
export function formatFreshnessDate(freshnessDate: string | null, locale: string): string | null {
  if (freshnessDate === null) return null
  return new Date(freshnessDate).toLocaleDateString(toIntlLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Returns a human-readable label for a recall status.
 * Handles all three cases: open, remedied, and unknown.
 */
/** `t` is the `SafetyTab` translator. */
export function recallStatusLabel(status: 'open' | 'remedied' | 'unknown', t: Translate): string {
  return t(`recallStatus.${status}`)
}

/** Severity level driving the at-a-glance safety status badge's color/icon. */
export type SafetyStatusLevel = 'good' | 'caution' | 'alert'

export interface SafetyStatusSummary {
  level: SafetyStatusLevel
  label: string
}

/**
 * Combines open recall count and NHTSA overall rating into a single
 * at-a-glance summary for the safety status badge shown above the detailed
 * recall/complaint lists. An open recall always takes precedence — it's the
 * most actionable fact — followed by a low rating, then a clean bill of health.
 */
export function safetyStatusSummary(
  openRecallCount: number,
  overallRating: number | null,
  t: Translate,
): SafetyStatusSummary {
  if (openRecallCount > 0) {
    return {
      level: 'alert',
      label: t('openRecalls', { count: openRecallCount }),
    }
  }

  if (overallRating !== null && overallRating <= 2) {
    return {
      level: 'caution',
      label: t('noOpenRecallsRating', { rating: overallRating }),
    }
  }

  if (overallRating !== null) {
    return {
      level: 'good',
      label: t('noOpenRecallsRating', { rating: overallRating }),
    }
  }

  return { level: 'good', label: t('noOpenRecalls') }
}
