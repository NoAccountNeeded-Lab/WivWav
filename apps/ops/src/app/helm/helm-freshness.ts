/**
 * Per-resource freshness for /helm (issue #1071). A resource that failed
 * after a success keeps showing the last good data but is marked stale; one
 * that never succeeded is unavailable. Missing observability must never be
 * read as healthy, so every consumer goes through these states.
 */

export type Freshness = 'loading' | 'fresh' | 'stale' | 'unavailable'

export interface FreshnessInput {
  data: unknown
  error: string | null
  isLoading: boolean
  updatedAt: Date | null
}

/** A success older than this many poll intervals is stale even without an error (e.g. hidden tab). */
const STALE_AFTER_INTERVALS = 2.5

export function resourceFreshness(input: FreshnessInput, nowMs: number, intervalMs: number): Freshness {
  if (input.data === null || input.data === undefined) {
    if (input.error) return 'unavailable'
    return input.isLoading ? 'loading' : 'unavailable'
  }
  if (input.error) return 'stale'
  if (input.updatedAt && nowMs - input.updatedAt.getTime() > intervalMs * STALE_AFTER_INTERVALS) return 'stale'
  return 'fresh'
}

export function freshnessLabel(freshness: Freshness): string {
  switch (freshness) {
    case 'loading': return 'Loading'
    case 'fresh': return 'Live'
    case 'stale': return 'Stale — showing last successful data'
    case 'unavailable': return 'Unavailable'
  }
}
