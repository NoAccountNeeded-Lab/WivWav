/**
 * Pure layout logic for the recurring-jobs timeline (issue #610). Kept
 * separate from ScheduleTimeline.tsx so the axis math is unit-testable
 * without rendering React, mirroring overview-helpers.ts.
 */

export type ScheduleTimelineVariant = 'success' | 'danger' | 'neutral'

export interface ScheduleTimelineInput {
  id: string
  label: string
  enabled: boolean
  next: number | null
  lastRunAt: string | null
  lastStatus: 'active' | 'completed' | 'failed' | null
}

export interface TimelinePosition {
  /** Percentage (0-100) along the shared axis, clamped to the visible window. */
  pct: number
  /** Set when the real timestamp falls outside the visible window and the marker was clamped to an edge. */
  overflow: 'before' | 'after' | null
}

export interface ScheduleTimelineRow {
  id: string
  label: string
  enabled: boolean
  /** Color variant for markers on this row, matching the table's badge variant for lastStatus. */
  variant: ScheduleTimelineVariant
  next: TimelinePosition | null
  lastRun: TimelinePosition | null
}

export interface ScheduleTimelineTick {
  pct: number
  label: string
}

export interface ScheduleTimelineModel {
  nowPct: number
  ticks: ScheduleTimelineTick[]
  rows: ScheduleTimelineRow[]
}

/** Half-width of the visible axis window around "now", per the issue's proposed "now ± 24h" view. */
export const TIMELINE_WINDOW_MS = 24 * 60 * 60 * 1000

const TICKS: ScheduleTimelineTick[] = [
  { pct: 0, label: '-24h' },
  { pct: 25, label: '-12h' },
  { pct: 50, label: 'Now' },
  { pct: 75, label: '+12h' },
  { pct: 100, label: '+24h' },
]

export function variantForStatus(status: ScheduleTimelineInput['lastStatus']): ScheduleTimelineVariant {
  if (status === 'failed') return 'danger'
  if (status === 'active') return 'success'
  return 'neutral'
}

/**
 * Maps an absolute timestamp onto the shared now ± TIMELINE_WINDOW_MS axis.
 * Timestamps outside the window are clamped to the nearest edge and flagged
 * via `overflow` so the UI can render an out-of-range indicator instead of
 * silently misplacing the marker.
 */
export function positionOnTimeline(ts: number, now: number): TimelinePosition {
  const start = now - TIMELINE_WINDOW_MS
  const end = now + TIMELINE_WINDOW_MS
  if (ts < start) return { pct: 0, overflow: 'before' }
  if (ts > end) return { pct: 100, overflow: 'after' }
  return { pct: ((ts - start) / (end - start)) * 100, overflow: null }
}

export function buildScheduleTimelineModel(entries: ScheduleTimelineInput[], now: number): ScheduleTimelineModel {
  const rows: ScheduleTimelineRow[] = [...entries]
    .sort(compareByNextRun)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      enabled: entry.enabled,
      variant: variantForStatus(entry.lastStatus),
      next: entry.enabled && entry.next != null ? positionOnTimeline(entry.next, now) : null,
      lastRun: entry.lastRunAt != null ? positionOnTimeline(new Date(entry.lastRunAt).getTime(), now) : null,
    }))

  return { nowPct: 50, ticks: TICKS, rows }
}

/** Soonest next run first; entries without a next run (disabled or unscheduled) sort last. */
function compareByNextRun(a: ScheduleTimelineInput, b: ScheduleTimelineInput): number {
  const aNext = a.enabled ? a.next : null
  const bNext = b.enabled ? b.next : null
  if (aNext == null && bNext == null) return 0
  if (aNext == null) return 1
  if (bNext == null) return -1
  return aNext - bNext
}
