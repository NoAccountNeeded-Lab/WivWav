'use client'

import styles from '../ops.module.css'
import { buildScheduleTimelineModel, type ScheduleTimelineRow } from './schedule-timeline-model'
import type { ScheduleEntry } from './SchedulesClient'

interface ScheduleTimelineProps {
  schedules: ScheduleEntry[]
}

/**
 * Horizontal "now ± 24h" timeline of recurring jobs, positioned above the
 * existing schedules table (issue #610). Purely additive — enable/disable,
 * edit, and clear-failed actions stay on the table below, which remains the
 * authoritative accessible source for exact times; this view is decorative
 * (aria-hidden) with a text caption summarizing counts, matching the
 * ScrapeRunChart/QueueDepthChart convention in src/components/SparklineChart.tsx.
 */
export function ScheduleTimeline({ schedules }: ScheduleTimelineProps) {
  const model = buildScheduleTimelineModel(schedules, Date.now())
  const failedCount = model.rows.filter((row) => row.variant === 'danger').length
  const disabledCount = model.rows.filter((row) => !row.enabled).length
  const enabledCount = model.rows.length - disabledCount

  return (
    <figure className={styles.timeline} aria-label="Recurring job schedule timeline, now plus or minus 24 hours">
      <div className={styles.timelineAxis} aria-hidden="true">
        {model.ticks.map((tick) => (
          <span key={tick.label} className={styles.timelineTick} style={{ left: `${tick.pct}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div className={styles.timelineRows} aria-hidden="true">
        {model.rows.map((row) => (
          <TimelineRow key={row.id} row={row} nowPct={model.nowPct} />
        ))}
      </div>
      <figcaption className={styles.timelineCaption}>
        {model.rows.length} job{model.rows.length === 1 ? '' : 's'} · {enabledCount} enabled · {failedCount} recently failed · {disabledCount} disabled
      </figcaption>
    </figure>
  )
}

function TimelineRow({ row, nowPct }: { row: ScheduleTimelineRow; nowPct: number }) {
  return (
    <div className={styles.timelineRow} data-enabled={row.enabled ? 'true' : 'false'}>
      <span className={styles.timelineRowLabel}>
        <span className={styles.timelineRowLabelText}>{row.label}</span>
        {!row.enabled && <span className={styles.timelineDisabledTag}>Disabled</span>}
      </span>
      <span className={styles.timelineTrack}>
        <span className={styles.timelineNowLine} style={{ left: `${nowPct}%` }} />
        {row.lastRun && (
          <span
            className={styles.timelineMarker}
            data-kind="last"
            data-variant={row.variant}
            title={`${row.label}: last run ${overflowLabel(row.lastRun.overflow, 'ago', 'from now')}`}
            style={{ left: `${row.lastRun.pct}%` }}
          />
        )}
        {row.next && (
          <span
            className={styles.timelineMarker}
            data-kind="next"
            data-variant={row.variant}
            title={`${row.label}: next run ${overflowLabel(row.next.overflow, 'ago', 'from now')}`}
            style={{ left: `${row.next.pct}%` }}
          />
        )}
      </span>
    </div>
  )
}

/** Describes a clamped marker in either direction — a stale `next` or a lastRun somehow in the future both get a sensible label. */
function overflowLabel(overflow: 'before' | 'after' | null, pastSuffix: string, futureSuffix: string): string {
  if (overflow === 'before') return `more than 24h ${pastSuffix}`
  if (overflow === 'after') return `more than 24h ${futureSuffix}`
  return 'shown on axis'
}
