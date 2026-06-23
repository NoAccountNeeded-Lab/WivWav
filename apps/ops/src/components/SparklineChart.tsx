'use client'

import styles from './SparklineChart.module.css'

/* ── Scrape Run Bar Chart ───────────────────────────────────────────────────── */

export interface ScrapeRunPoint {
  label: string        // e.g. "BLVD.com"
  success: boolean | null
  listingsFound: number | null
}

interface ScrapeRunChartProps {
  runs: ScrapeRunPoint[]
  /** Maximum bars to display, defaults to 20 */
  maxBars?: number
  /** ARIA label for the chart region */
  ariaLabel?: string
}

/**
 * Bar chart of recent scrape run results.
 * Each bar represents one run; green = success, red = failure, gray = unknown.
 * Height encodes listingsFound when available; otherwise fixed at 50%.
 * Colour is never the only indicator — shape and aria-label also convey status.
 */
export function ScrapeRunChart({ runs, maxBars = 20, ariaLabel = 'Recent scrape run results' }: ScrapeRunChartProps) {
  const visible = runs.slice(-maxBars)

  if (visible.length === 0) {
    return (
      <div className={styles.empty} role="img" aria-label={ariaLabel}>
        <span className={styles.emptyText}>No scrape run data yet</span>
      </div>
    )
  }

  const maxListings = Math.max(1, ...visible.map(r => r.listingsFound ?? 0))

  return (
    <figure className={styles.figure} aria-label={ariaLabel}>
      <div className={styles.barChart} aria-hidden="true">
        {visible.map((run, i) => {
          const heightPct = run.listingsFound != null
            ? Math.max(12, Math.round((run.listingsFound / maxListings) * 100))
            : 50
          const status = run.success === true ? 'success' : run.success === false ? 'failure' : 'unknown'
          return (
            <div
              key={i}
              className={styles.barWrap}
              title={`${run.label}: ${status}${run.listingsFound != null ? `, ${run.listingsFound} listings` : ''}`}
            >
              <div
                className={styles.bar}
                data-status={status}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>
      <figcaption className={styles.chartCaption}>
        {visible.length} runs · {visible.filter(r => r.success === true).length} passed · {visible.filter(r => r.success === false).length} failed
      </figcaption>
    </figure>
  )
}

/* ── Queue Depth Line Chart ─────────────────────────────────────────────────── */

export interface QueueDepthPoint {
  /** Unix epoch ms */
  timestamp: number
  /** waiting + active + delayed */
  depth: number
  /** failed job count */
  failed: number
}

interface QueueDepthChartProps {
  series: QueueDepthPoint[]
  /** Queue display name */
  queueName: string
  /** ARIA label for the chart region */
  ariaLabel?: string
}

const CHART_W = 200
const CHART_H = 48

/**
 * Miniature polyline chart for queue depth over polling cycles.
 * Renders as SVG; uses CSS custom properties for colors.
 * Shows empty state if fewer than 2 data points are available.
 */
export function QueueDepthChart({ series, queueName, ariaLabel }: QueueDepthChartProps) {
  const label = ariaLabel ?? `${queueName} queue depth over time`

  if (series.length < 2) {
    return (
      <div className={styles.empty} role="img" aria-label={label}>
        <span className={styles.emptyText}>Accumulating data, please wait</span>
      </div>
    )
  }

  const maxDepth = Math.max(1, ...series.map(p => Math.max(p.depth, p.failed)))

  const depthPoints = series.map((p, i) => {
    const x = (i / (series.length - 1)) * CHART_W
    const y = CHART_H - Math.round((p.depth / maxDepth) * CHART_H)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const hasAnyFailed = series.some(p => p.failed > 0)
  const failedPoints = hasAnyFailed
    ? series.map((p, i) => {
        const x = (i / (series.length - 1)) * CHART_W
        const y = CHART_H - Math.round((p.failed / maxDepth) * CHART_H)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
    : null

  const latestDepth = series[series.length - 1]?.depth ?? 0
  const latestFailed = series[series.length - 1]?.failed ?? 0

  return (
    <figure className={styles.figure} aria-label={label}>
      <svg
        className={styles.lineChart}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Grid line at top */}
        <line x1="0" y1="1" x2={CHART_W} y2="1" className={styles.gridLine} />
        {/* Depth polyline */}
        <polyline
          points={depthPoints.join(' ')}
          className={styles.depthLine}
          fill="none"
        />
        {/* Failed polyline (only when non-zero) */}
        {failedPoints && (
          <polyline
            points={failedPoints.join(' ')}
            className={styles.failedLine}
            fill="none"
          />
        )}
      </svg>
      <figcaption className={styles.chartCaption}>
        Now: {latestDepth} pending{latestFailed > 0 ? `, ${latestFailed} failed` : ''} · {series.length} samples
      </figcaption>
    </figure>
  )
}
