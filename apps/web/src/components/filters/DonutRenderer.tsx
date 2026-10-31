'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { CategoricalRendererProps } from './types'
import { FacetTooltip } from './FacetTooltip'
import styles from './DonutRenderer.module.css'

// ── SVG arc helpers ────────────────────────────────────────────────────────────

const CX = 60
const CY = 60
const R_OUTER = 52
const R_INNER = 32

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(startDeg: number, endDeg: number): string {
  const s = endDeg - startDeg
  // Full circle: use a special path to avoid degenerate arc
  if (s >= 359.99) {
    return [
      `M ${CX} ${CY - R_OUTER}`,
      `A ${R_OUTER} ${R_OUTER} 0 1 1 ${CX - 0.001} ${CY - R_OUTER}`,
      `L ${CX - 0.001} ${CY - R_INNER}`,
      `A ${R_INNER} ${R_INNER} 0 1 0 ${CX} ${CY - R_INNER}`,
      'Z',
    ].join(' ')
  }
  const large = s > 180 ? 1 : 0
  const o1 = polar(CX, CY, R_OUTER, startDeg)
  const o2 = polar(CX, CY, R_OUTER, endDeg)
  const i1 = polar(CX, CY, R_INNER, endDeg)
  const i2 = polar(CX, CY, R_INNER, startDeg)
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${i2.x} ${i2.y}`,
    'Z',
  ].join(' ')
}

// ── Palette ────────────────────────────────────────────────────────────────────
// Unselected slices use the public teal marks; selection is deep purple plus an offset
// and a checkmark, so it never depends on color alone.

const TEAL_MARKS = ['var(--clr-chart-teal-mark-1)', 'var(--clr-chart-teal-mark-2)', 'var(--clr-chart-teal-mark-3)']
const SELECTED_FILL = 'var(--clr-chart-selected-strong)'
const HOVER_OFFSET = 2
const SELECTED_OFFSET = 4

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Selectable donut. The legend rows are the keyboard/touch/screen-reader controls (large targets
 * even for tiny slices, and they carry zero-count selected values); slices mirror them for pointer use.
 */
export function DonutRenderer({ items, onToggle }: CategoricalRendererProps) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const enabled = items.filter((i) => i.count > 0 || i.active)
  const total = enabled.reduce((s, i) => s + i.count, 0) || 1

  // Colors follow the value's position in an alphabetical order, so they do not reshuffle as counts change.
  const colorIndex = new Map([...items].sort((a, b) => a.value.localeCompare(b.value)).map((item, idx) => [item.value, idx]))
  const colorFor = (value: string) => TEAL_MARKS[(colorIndex.get(value) ?? 0) % TEAL_MARKS.length]!

  let cursor = 0
  const segments = enabled.map((item) => {
    const deg = (item.count / total) * 360
    const start = cursor
    cursor += deg
    return { item, start, end: cursor }
  })

  const activeCount = enabled.filter((i) => i.active).reduce((s, i) => s + i.count, 0)
  const centerLabel = items.some((i) => i.active) ? activeCount.toLocaleString() : total.toLocaleString()

  return (
    <div className={styles.root}>
      <svg className={styles.donut} viewBox="-8 -8 136 136" aria-hidden="true">
        {segments.filter(({ end, start }) => end > start).map(({ item, start, end }) => {
          const lifted = item.active ? SELECTED_OFFSET : highlight === item.value ? HOVER_OFFSET : 0
          const mid = polar(0, 0, 1, (start + end) / 2)
          return (
            <path
              key={item.value}
              d={arcPath(start, end)}
              className={`${styles.segment}${item.disabled ? '' : ` ${styles.clickable}`}`}
              style={{ transform: `translate(${(mid.x * lifted).toFixed(2)}px, ${(mid.y * lifted).toFixed(2)}px)` }}
              fill={item.active ? SELECTED_FILL : colorFor(item.value)}
              opacity={item.disabled ? 0.4 : 1}
              onMouseEnter={() => setHighlight(item.value)}
              onMouseLeave={() => setHighlight(null)}
              onClick={() => { if (!item.disabled) onToggle(item.value) }}
            />
          )
        })}
        <text x={CX} y={CY} className={styles.centerText} textAnchor="middle" dominantBaseline="middle">
          {centerLabel}
        </text>
      </svg>

      <ul className={styles.legend} role="list">
        {enabled.map((item) => (
          <li key={item.value}>
            <FacetTooltip text={`${item.label}: ${item.count.toLocaleString()}`}>
              <button
                type="button"
                className={`${styles.legendRow} ${item.active ? styles.legendActive : ''}`}
                disabled={item.disabled}
                aria-pressed={item.active}
                onClick={() => onToggle(item.value)}
                onMouseEnter={() => setHighlight(item.value)}
                onMouseLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(item.value)}
                onBlur={() => setHighlight(null)}
              >
                <span
                  className={styles.swatch}
                  style={{ background: item.active ? SELECTED_FILL : colorFor(item.value) }}
                  aria-hidden="true"
                />
                <span className={styles.legendLabel}>{item.label}</span>
                <span className={styles.check} aria-hidden="true">{item.active && <Check size={14} strokeWidth={3} />}</span>
                <span className={styles.legendCount}>{item.count.toLocaleString()}</span>
              </button>
            </FacetTooltip>
          </li>
        ))}
      </ul>
    </div>
  )
}
