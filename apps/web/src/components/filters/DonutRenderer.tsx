'use client'

import type { CategoricalRendererProps } from './types'
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

const PALETTE = [
  'var(--clr-primary)',
  'rgba(92,53,198,0.55)',
  'rgba(92,53,198,0.32)',
  'rgba(92,53,198,0.18)',
  '#a78bfa',
  '#7c3aed',
  '#c4b5fd',
  '#6d28d9',
]

// ── Component ──────────────────────────────────────────────────────────────────

export function DonutRenderer({ items, onToggle }: CategoricalRendererProps) {
  const enabled = items.filter((i) => i.count > 0 || i.active)
  const total = enabled.reduce((s, i) => s + i.count, 0) || 1

  let cursor = 0
  const segments = enabled.map((item, idx) => {
    const deg = (item.count / total) * 360
    const start = cursor
    cursor += deg
    return { item, start, end: cursor, color: PALETTE[idx % PALETTE.length]! }
  })

  const activeCount = enabled.filter((i) => i.active).reduce((s, i) => s + i.count, 0)
  const centerLabel = items.filter((i) => i.active).length > 0
    ? activeCount.toLocaleString()
    : total.toLocaleString()

  return (
    <div className={styles.root}>
      {/* Donut */}
      <svg
        className={styles.donut}
        viewBox="0 0 120 120"
        aria-hidden="true"
      >
        {segments.map(({ item, start, end, color }) => (
          <path
            key={item.value}
            d={arcPath(start, end)}
            fill={item.active ? color : item.disabled ? 'var(--clr-border)' : color}
            opacity={item.active ? 1 : item.disabled ? 0.4 : 0.35}
            className={styles.segment}
            onClick={() => !item.disabled && onToggle(item.value)}
            role="button"
            aria-pressed={item.active}
            aria-label={`${item.label}: ${item.count.toLocaleString()}`}
            tabIndex={item.disabled ? -1 : 0}
            onKeyDown={(e) => e.key === 'Enter' || e.key === ' ' ? onToggle(item.value) : undefined}
          />
        ))}
        <text x={CX} y={CY} className={styles.centerText} textAnchor="middle" dominantBaseline="middle">
          {centerLabel}
        </text>
      </svg>

      {/* Legend */}
      <ul className={styles.legend} role="list">
        {enabled.map((item, idx) => (
          <li key={item.value}>
            <button
              type="button"
              className={`${styles.legendRow} ${item.active ? styles.legendActive : ''}`}
              disabled={item.disabled}
              aria-pressed={item.active}
              onClick={() => onToggle(item.value)}
            >
              <span
                className={styles.swatch}
                style={{ background: PALETTE[idx % PALETTE.length] }}
                aria-hidden="true"
              />
              <span className={styles.legendLabel}>{item.label}</span>
              <span className={styles.legendCount}>{item.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
