'use client'

import { Bot } from 'lucide-react'
import styles from './OpsProgress.module.css'

/* ── Honest progress (A5) ──────────────────────────────────────────────────
   Hard rule: an animated indicator may only claim progress it can prove.
   - OpsProgressDeterminate renders real role="progressbar" semantics; its
     visual fill/marker position is derived only from value/min/max — never
     from elapsed time or a fixed animation duration.
   - OpsProgressIndeterminate never renders a percentage or a partial track
     fill; it shows a looping decorative sweep plus plain-language status
     text, and is exposed as a status region rather than a progressbar.
────────────────────────────────────────────────────────────────────────────── */

interface OpsProgressDeterminateProps {
  /** Current progress value. */
  value: number
  /** Minimum value. Defaults to 0. */
  min?: number
  /** Maximum value. Defaults to 100. */
  max?: number
  /** Accessible name for the progressbar. */
  label: string
  /** Optional caption shown under the track, e.g. "42 / 100 sources". */
  caption?: string | undefined
  className?: string | undefined
}

/**
 * Determinate progress track. The scraper-bot marker and fill width are
 * computed solely from (value - min) / (max - min); no timers, no
 * hard-coded animation duration is involved in the position math.
 */
export function OpsProgressDeterminate({
  value,
  min = 0,
  max = 100,
  label,
  caption,
  className,
}: OpsProgressDeterminateProps) {
  const range = max - min
  const rawPct = range > 0 ? ((value - min) / range) * 100 : 0
  const pct = Math.min(100, Math.max(0, rawPct))

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
      >
        <span className={styles.fill} style={{ width: `${pct}%` }} />
        <span className={styles.marker} style={{ left: `${pct}%` }} aria-hidden="true">
          <Bot size={12} />
        </span>
      </div>
      {caption && <p className={styles.caption}>{caption}</p>}
    </div>
  )
}

interface OpsProgressIndeterminateProps {
  /** Plain-language status, e.g. "Fetching sources…" */
  statusText: string
  className?: string | undefined
}

/**
 * Indeterminate progress indicator. Shows a looping decorative sweep plus
 * status text. Deliberately has no `value`/`max` props and never renders a
 * percentage or a measured track fill — there is nothing here to fake.
 */
export function OpsProgressIndeterminate({ statusText, className }: OpsProgressIndeterminateProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <div className={styles.indeterminateTrack} aria-hidden="true">
        <span className={styles.indeterminateSweep} />
      </div>
      <p className={styles.statusText}>{statusText}</p>
    </div>
  )
}
