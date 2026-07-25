/** Shared ≤24h / default-1h window bounds for `get_system_snapshot` and `get_correlation` (#775). */
export const DEFAULT_WINDOW_MINUTES = 60
export const MAX_WINDOW_MINUTES = 24 * 60

/** Clamp a caller-supplied `windowMinutes` querystring value into `[1, MAX_WINDOW_MINUTES]`, defaulting to `DEFAULT_WINDOW_MINUTES` when absent or not a positive integer. */
export function resolveWindowMinutes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_WINDOW_MINUTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_MINUTES
  return Math.min(parsed, MAX_WINDOW_MINUTES)
}

export interface ResolvedWindow {
  minutes: number
  sinceMs: number
  untilMs: number
  since: string
  until: string
}

export function resolveWindow(raw: string | undefined, nowMs: number): ResolvedWindow {
  const minutes = resolveWindowMinutes(raw)
  const sinceMs = nowMs - minutes * 60_000
  return {
    minutes,
    sinceMs,
    untilMs: nowMs,
    since: new Date(sinceMs).toISOString(),
    until: new Date(nowMs).toISOString(),
  }
}
