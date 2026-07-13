'use client'

import * as React from 'react'

export interface ScrapeRunPoint {
  label: string // e.g. "BLVD.com"
  success: boolean | null
  listingsFound: number | null
}

export interface ScrapeRunChartProps {
  runs: ScrapeRunPoint[]
  /** Maximum bars to display, defaults to 20 */
  maxBars?: number
  /** ARIA label for the chart region */
  ariaLabel?: string
}

type RunStatus = 'success' | 'failure' | 'unknown'

const STATUS_COLORS: Record<RunStatus, string> = {
  success: 'var(--clr-success, #15803d)',
  failure: 'var(--clr-danger, #b42318)',
  unknown: 'var(--clr-text-muted, #64748b)',
}

const defaultStyles: Record<string, React.CSSProperties> = {
  figure: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    margin: 0,
    padding: 0,
    width: '100%',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '3.5rem',
    border: '1px dashed var(--clr-border, #e2e8f0)',
    borderRadius: 'var(--radius, 8px)',
    background: 'color-mix(in srgb, var(--clr-text-muted, #64748b) 4%, transparent)',
  },
  emptyText: {
    color: 'var(--clr-text-muted, #64748b)',
    fontSize: '0.6875rem',
    fontFamily: 'var(--font-ui, system-ui)',
    fontWeight: 500,
  },
  barChart: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '2px',
    height: '3.5rem',
    width: '100%',
    overflow: 'hidden',
  },
  barWrap: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    height: '100%',
    minWidth: '3px',
    maxWidth: '16px',
  },
  bar: {
    width: '100%',
    borderRadius: '2px 2px 0 0',
    transition: 'opacity 0.15s',
  },
  chartCaption: {
    color: 'var(--clr-text-muted, #64748b)',
    fontSize: '0.625rem',
    fontFamily: 'var(--font-ui, system-ui)',
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: '0.02em',
  },
}

/**
 * Bar chart of recent scrape run results.
 * Each bar represents one run; green = success, red = failure, gray = unknown.
 * Height encodes listingsFound when available; otherwise fixed at 50%.
 * Colour is never the only indicator — shape and aria-label also convey status.
 */
export function ScrapeRunChart({ runs, maxBars = 20, ariaLabel = 'Recent scrape run results' }: ScrapeRunChartProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const visible = runs.slice(-maxBars)

  if (visible.length === 0) {
    return (
      <div style={defaultStyles.empty} role="img" aria-label={ariaLabel}>
        <span style={defaultStyles.emptyText}>No scrape run data yet</span>
      </div>
    )
  }

  const maxListings = Math.max(1, ...visible.map(r => r.listingsFound ?? 0))

  return (
    <figure style={defaultStyles.figure} aria-label={ariaLabel}>
      <div style={defaultStyles.barChart} aria-hidden="true">
        {visible.map((run, i) => {
          const heightPct = run.listingsFound != null
            ? Math.max(12, Math.round((run.listingsFound / maxListings) * 100))
            : 50
          const status: RunStatus = run.success === true ? 'success' : run.success === false ? 'failure' : 'unknown'
          const baseOpacity = status === 'unknown' ? 0.4 : 1
          return (
            <div
              key={i}
              style={defaultStyles.barWrap}
              title={`${run.label}: ${status}${run.listingsFound != null ? `, ${run.listingsFound} listings` : ''}`}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(prev => (prev === i ? null : prev))}
            >
              <div
                style={{
                  ...defaultStyles.bar,
                  height: `${heightPct}%`,
                  background: STATUS_COLORS[status],
                  opacity: hoveredIndex === i ? 0.75 : baseOpacity,
                }}
              />
            </div>
          )
        })}
      </div>
      <figcaption style={defaultStyles.chartCaption}>
        {visible.length} runs · {visible.filter(r => r.success === true).length} passed · {visible.filter(r => r.success === false).length} failed
      </figcaption>
    </figure>
  )
}
