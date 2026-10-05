'use client'

import * as React from 'react'
import { Bar, BarChart as RechartsBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface StackedBarSeries {
  key: string
  label: string
  /** CSS colour or custom property for the segment fill. */
  fill: string
  /** CSS colour for the segment outline; defaults to the fill. */
  stroke?: string
}

export interface StackedBarRow {
  key: string
  label: string
  /** One non-negative number per series key; a missing key is drawn as zero. */
  values: Record<string, number>
  /** Exact figures shown under the label, e.g. "12 waiting · 3 running". */
  valueText: string
}

export interface StackedBarListProps {
  rows: StackedBarRow[]
  series: StackedBarSeries[]
  /** Accessible name; the chart caption and any numbers table should say the same thing visibly. */
  'aria-label': string
  /** Unit word for the tooltip and the value axis, e.g. "jobs". */
  unit: string
  className?: string
}

const LINE_HEIGHT = 15
const ROW_BASE = 28
const MAX_LINE_CHARS = 26
const MAX_LABEL_CHARS = 20
const AXIS_HEIGHT = 28
const LABEL_WIDTH = 168

/** Word-wraps a bold row label so a long name stays inside the label column. */
function wrapLabel(text: string): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (current !== '' && `${current} ${word}`.length > MAX_LABEL_CHARS) {
      lines.push(current)
      current = word
    } else {
      current = current === '' ? word : `${current} ${word}`
    }
  }
  if (current !== '') lines.push(current)
  return lines.length > 0 ? lines : ['']
}

/** Wraps between " · " segments so each line is a whole figure and nothing is clipped in the label column. */
function wrap(text: string): string[] {
  const lines: string[] = []
  let current = ''
  for (const segment of text.split(' · ')) {
    if (current !== '' && `${current} · ${segment}`.length > MAX_LINE_CHARS) {
      lines.push(current)
      current = segment
    } else {
      current = current === '' ? segment : `${current} · ${segment}`
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

interface TickProps {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
}

/**
 * Horizontal stacked bars, one row per category. Each row's label and exact
 * figures are written as text beside the bar so the chart reads without
 * colour, hover or any pointer. Recharts' keyboard layer (arrow keys on the
 * focused chart) drives the tooltip. Rows keep the order given: callers rank.
 */
export function StackedBarList({ rows, series, 'aria-label': ariaLabel, unit, className }: StackedBarListProps) {
  const byLabel = React.useMemo(() => new Map(rows.map(row => [row.label, row])), [rows])
  const data = React.useMemo(() => rows.map(row => ({ ...row.values, label: row.label })), [rows])
  const lineCount = React.useMemo(() => Math.max(2, ...rows.map(row => wrapLabel(row.label).length + wrap(row.valueText).length)), [rows])
  const rowHeight = ROW_BASE - LINE_HEIGHT + lineCount * LINE_HEIGHT
  const height = rows.length * rowHeight + AXIS_HEIGHT

  const renderTick = (props: TickProps) => {
    const x = Number(props.x ?? 0)
    const y = Number(props.y ?? 0)
    const label = String(props.payload?.value ?? '')
    const labelLines = wrapLabel(label)
    const lines = wrap(byLabel.get(label)?.valueText ?? '')
    const top = -((labelLines.length + lines.length) * LINE_HEIGHT) / 2 + 11
    return (
      <g transform={`translate(${x},${y})`}>
        {labelLines.map((line, index) => (
          <text key={`l${index}`} x={-8} y={top + index * LINE_HEIGHT} textAnchor="end" fontSize={13} fontWeight={600} fill="var(--clr-text, #0f172a)">{line}</text>
        ))}
        {lines.map((line, index) => (
          <text key={`v${index}`} x={-8} y={top + (labelLines.length + index) * LINE_HEIGHT} textAnchor="end" fontSize={12} fill="var(--clr-text-secondary, #475569)">{line}</text>
        ))}
      </g>
    )
  }

  const renderTooltip = ({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>; label?: unknown }) => {
    if (!active || !payload || payload.length === 0) return null
    const row = byLabel.get(String(label ?? ''))
    return (
      <div style={tooltipStyle}>
        <strong>{String(label ?? '')}</strong>
        {series.map(item => {
          const entry = payload.find(p => p.dataKey === item.key)
          return <div key={item.key}>{item.label}: {Number(entry?.value ?? 0).toLocaleString()} {unit}</div>
        })}
        {row && <div style={{ color: 'var(--clr-text-secondary, #475569)' }}>{row.valueText}</div>}
      </div>
    )
  }

  return (
    <figure style={{ margin: 0, display: 'grid', gap: '0.5rem' }} aria-label={ariaLabel}>
      <ul style={legendStyle} aria-label="Legend">
        {series.map(item => (
          <li key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: item.fill, border: `2px solid ${item.stroke ?? item.fill}`, display: 'inline-block' }} />
            {item.label}
          </li>
        ))}
      </ul>
      <div className={className} style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 480, height }}>
          <RechartsBarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={10}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--clr-text-secondary, #475569)' }} stroke="var(--clr-border-strong, #94a3b8)" />
            <YAxis type="category" dataKey="label" width={LABEL_WIDTH} tick={renderTick} tickLine={false} axisLine={false} interval={0} />
            <Tooltip content={renderTooltip} cursor={{ fill: 'var(--clr-border, #e2e8f0)', opacity: 0.4 }} isAnimationActive={false} />
            {series.map(item => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stackId="stack"
                fill={item.fill}
                stroke={item.stroke ?? item.fill}
                strokeWidth={1.5}
                isAnimationActive={false}
                maxBarSize={22}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

const legendStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem 1rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  color: 'var(--clr-text, #0f172a)',
  fontFamily: 'var(--font-ui, system-ui)',
  fontSize: '0.8125rem',
}

const tooltipStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.125rem',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--clr-border-strong, #94a3b8)',
  borderRadius: 'var(--radius, 6px)',
  background: 'var(--clr-surface, #ffffff)',
  color: 'var(--clr-text, #0f172a)',
  fontFamily: 'var(--font-ui, system-ui)',
  fontSize: '0.8125rem',
}
