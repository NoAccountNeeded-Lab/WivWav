'use client'

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLocale, useTranslations } from 'next-intl'
import { toIntlLocale } from '@/lib/intl'
import type { VinHistoryEntry } from '@wivwav/types'
import { VinHistoryTable } from './VinHistoryTable'
import { VinHistoryTooltip } from './VinHistoryTooltip'
import { buildVinHistoryAxes, buildVinHistoryChartData, shouldShowVinHistory } from './vinHistory'

interface VinHistoryTimelineProps {
  history: VinHistoryEntry[]
  currentListingId: string
}

const TICK = { fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }

/** One chart line per series and listing; `series` picks the axis and the translation key. */
const LINES = [
  { series: 'price', dataKey: 'currentPriceCents', name: 'thisListingPrice', stroke: 'var(--color-primary-solid, #0d9488)', width: 2.25 },
  { series: 'price', dataKey: 'otherPriceCents', name: 'otherListingPrice', stroke: 'var(--color-text-secondary, #64748b)', width: 2 },
  { series: 'mileage', dataKey: 'currentMileage', name: 'thisListingMileage', stroke: 'var(--color-primary-text, #0f766e)', width: 2, dash: '5 4' },
  { series: 'mileage', dataKey: 'otherMileage', name: 'otherListingMileage', stroke: 'var(--color-text-placeholder, #94a3b8)', width: 2, dash: '5 4' },
] as const

export function VinHistoryTimeline({ history, currentListingId }: VinHistoryTimelineProps) {
  const t = useTranslations('VinHistoryTimeline')
  const locale = useLocale()
  if (!shouldShowVinHistory(history)) return null

  const data = buildVinHistoryChartData(history, currentListingId, t, locale)
  const { listingCount, changeKeys, price, mileage } = buildVinHistoryAxes(history, data)
  const shown = { price: price.show, mileage: mileage.show }
  const compact = (v: number) => v.toLocaleString(toIntlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 })

  return (
    <div>
      <div aria-label={t('label', { count: listingCount })} role="img" style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" vertical={false} />
            <XAxis dataKey="key" tickFormatter={(_, index: number) => data[index]?.label ?? ''} tick={TICK} axisLine={false} tickLine={false} />
            {price.show && (
              <YAxis yAxisId="price" domain={price.domain} tickFormatter={(v: number) => `$${compact(v / 100)}`} tick={TICK} axisLine={false} tickLine={false} width={56} />
            )}
            {mileage.show && (
              <YAxis yAxisId="mileage" orientation="right" domain={mileage.domain} tickFormatter={(v: number) => t('miles', { miles: compact(v) })} tick={TICK} axisLine={false} tickLine={false} width={58} />
            )}
            <Tooltip content={<VinHistoryTooltip locale={locale} t={t} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {changeKeys.map((key) => (
              <ReferenceLine key={key} x={key} yAxisId={price.show ? 'price' : 'mileage'} stroke="var(--color-border-strong, #94a3b8)" strokeDasharray="4 4" />
            ))}
            {LINES.filter((line) => shown[line.series]).map((line) => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                yAxisId={line.series}
                stroke={line.stroke}
                {...('dash' in line ? { strokeDasharray: line.dash } : {})}
                strokeWidth={line.width}
                dot={{ r: 3, fill: line.stroke, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                name={t(line.name)}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--clr-text-muted)' }}>
        {t('summary', { observations: history.length, listings: listingCount })}
      </p>
      <VinHistoryTable entries={history.filter((entry) => shown[entry.type])} currentListingId={currentListingId} locale={locale} t={t} />
    </div>
  )
}
