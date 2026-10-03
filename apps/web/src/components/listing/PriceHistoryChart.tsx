'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { useLocale, useTranslations } from 'next-intl'
import { toIntlLocale } from '@/lib/intl'
import type { PricePoint } from '@/app/[locale]/listings/[id]/types'

interface PriceHistoryChartProps {
  priceHistory: PricePoint[]
  originalMsrpCents?: number | null | undefined
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { month: 'short', day: 'numeric' })
}

function formatDollar(cents: number, locale: string): string {
  return `$${(cents / 100).toLocaleString(toIntlLocale(locale))}`
}

interface TooltipPayload {
  value?: number
  payload?: { label: string }
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  locale: string
}

function CustomTooltip({ active, payload, locale }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (entry?.value === undefined) return null
  return (
    <div
      style={{
        background: 'var(--color-surface, #fff)',
        border: '1px solid var(--color-border, #e2e8f0)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
      }}
    >
      <div style={{ color: 'var(--color-text-secondary, #64748b)' }}>
        {entry.payload?.label}
      </div>
      <div style={{ fontWeight: 600, color: 'var(--color-text, #0f172a)' }}>
        {formatDollar(entry.value, locale)}
      </div>
    </div>
  )
}

export function PriceHistoryChart({ priceHistory, originalMsrpCents }: PriceHistoryChartProps) {
  const t = useTranslations('PriceHistoryChart')
  const locale = useLocale()
  if (priceHistory.length < 2) return null

  const data = priceHistory.map((pt) => ({
    label: formatShortDate(pt.recordedAt, locale),
    priceCents: pt.priceCents,
  }))

  const msrpDollars = originalMsrpCents != null ? originalMsrpCents / 100 : null
  const allValues = data.map((d) => d.priceCents)
  if (msrpDollars !== null) allValues.push(originalMsrpCents!)
  const minVal = Math.min(...allValues)
  const maxVal = Math.max(...allValues)
  const padding = (maxVal - minVal) * 0.15 || 1000

  return (
    <div
      aria-label={t('label')}
      role="img"
      style={{ width: '100%', height: 180 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border, #e2e8f0)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[
              Math.max(0, Math.floor((minVal - padding) / 100) * 100),
              Math.ceil((maxVal + padding) / 100) * 100,
            ]}
            tickFormatter={(v: number) => `$${(v / 100).toLocaleString(toIntlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 })}`}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<CustomTooltip locale={locale} />} />
          <Line
            type="monotone"
            dataKey="priceCents"
            stroke="var(--color-primary-solid, #0d9488)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--color-primary-solid, #0d9488)', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            name={t('askingPrice')}
            isAnimationActive={false}
          />
          {originalMsrpCents != null && (
            <ReferenceLine
              y={originalMsrpCents}
              stroke="var(--color-text-secondary, #64748b)"
              strokeDasharray="5 3"
              label={{
                value: t('originalMsrp'),
                position: 'insideBottomRight',
                fontSize: 10,
                fill: 'var(--color-text-secondary, #64748b)',
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
