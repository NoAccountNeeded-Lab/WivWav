'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useLocale, useTranslations } from 'next-intl'
import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import type { VinHistoryEntry } from '@wivwav/types'
import { hasMultiListingVinHistory } from './vinHistory'

interface VinHistoryTimelineProps {
  history: VinHistoryEntry[]
  currentListingId: string
}

interface ChartDatum {
  key: string
  label: string
  listingId: string
  listingLabel: string
  currentPriceCents: number | null
  otherPriceCents: number | null
  currentMileage: number | null
  otherMileage: number | null
}

interface TooltipPayload {
  name?: string
  value?: number
  dataKey?: string
  payload?: ChartDatum
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  locale: string
  t: Translate
}

interface VisibleTooltipPayload extends TooltipPayload {
  value: number
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { month: 'short', day: 'numeric' })
}

function formatLongDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDollar(cents: number, locale: string): string {
  return `$${(cents / 100).toLocaleString(toIntlLocale(locale))}`
}

function formatMiles(miles: number, locale: string, t: Translate): string {
  return t('miles', { miles: miles.toLocaleString(toIntlLocale(locale)) })
}

function valueLabel(dataKey: string | undefined, value: number, locale: string, t: Translate): string {
  if (dataKey?.includes('Price')) return formatDollar(value, locale)
  return formatMiles(value, locale, t)
}

function listingLabel(listingId: string, currentListingId: string, t: Translate): string {
  return listingId === currentListingId ? t('thisListing') : t('otherListing')
}

/** `t` is the `VinHistoryTimeline` translator. */
export function buildVinHistoryChartData(
  history: VinHistoryEntry[],
  currentListingId: string,
  t: Translate,
  locale: string,
): ChartDatum[] {
  return [...history]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map((entry, index) => {
      const isCurrentListing = entry.listingId === currentListingId
      const isPrice = entry.type === 'price'

      return {
        key: `${entry.recordedAt}-${entry.listingId}-${entry.type}-${index}`,
        label: formatShortDate(entry.recordedAt, locale),
        listingId: entry.listingId,
        listingLabel: listingLabel(entry.listingId, currentListingId, t),
        currentPriceCents: isCurrentListing && isPrice ? entry.value : null,
        otherPriceCents: !isCurrentListing && isPrice ? entry.value : null,
        currentMileage: isCurrentListing && !isPrice ? entry.value : null,
        otherMileage: !isCurrentListing && !isPrice ? entry.value : null,
      }
    })
}

function CustomTooltip({ active, payload, locale, t }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((entry): entry is VisibleTooltipPayload => typeof entry.value === 'number')
  if (visible.length === 0) return null

  const point = visible[0]?.payload
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
        {point?.label} · {point?.listingLabel}
      </div>
      {visible.map((entry, index) => (
        <div key={`${entry.dataKey ?? 'series'}-${index}`} style={{ fontWeight: 600, color: 'var(--color-text, #0f172a)' }}>
          {entry.name}: {valueLabel(entry.dataKey, entry.value, locale, t)}
        </div>
      ))}
    </div>
  )
}

export function VinHistoryTimeline({ history, currentListingId }: VinHistoryTimelineProps) {
  const t = useTranslations('VinHistoryTimeline')
  const locale = useLocale()
  if (!hasMultiListingVinHistory(history)) return null

  const data = buildVinHistoryChartData(history, currentListingId, t, locale)
  const listingCount = new Set(history.map((entry) => entry.listingId)).size
  const priceValues = history.filter((entry) => entry.type === 'price').map((entry) => entry.value)
  const mileageValues = history.filter((entry) => entry.type === 'mileage').map((entry) => entry.value)
  const changeKeys = data
    .filter((entry, index) => index > 0 && data[index - 1]?.listingId !== entry.listingId)
    .map((entry) => entry.key)

  const priceMin = priceValues.length > 0 ? Math.min(...priceValues) : 0
  const priceMax = priceValues.length > 0 ? Math.max(...priceValues) : 1000
  const pricePadding = (priceMax - priceMin) * 0.15 || 1000
  const mileageMin = mileageValues.length > 0 ? Math.min(...mileageValues) : 0
  const mileageMax = mileageValues.length > 0 ? Math.max(...mileageValues) : 1000
  const mileagePadding = (mileageMax - mileageMin) * 0.15 || 1000

  return (
    <div>
      <div
        aria-label={t('label', { count: listingCount })}
        role="img"
        style={{ width: '100%', height: 240 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border, #e2e8f0)"
              vertical={false}
            />
            <XAxis
              dataKey="key"
              tickFormatter={(_, index: number) => data[index]?.label ?? ''}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="price"
              domain={[
                Math.max(0, Math.floor((priceMin - pricePadding) / 100) * 100),
                Math.ceil((priceMax + pricePadding) / 100) * 100,
              ]}
              tickFormatter={(v: number) => `$${(v / 100).toLocaleString(toIntlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 })}`}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <YAxis
              yAxisId="mileage"
              orientation="right"
              domain={[
                Math.max(0, Math.floor(mileageMin - mileagePadding)),
                Math.ceil(mileageMax + mileagePadding),
              ]}
              tickFormatter={(v: number) => t('miles', {
                miles: v.toLocaleString(toIntlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }),
              })}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary, #64748b)' }}
              axisLine={false}
              tickLine={false}
              width={58}
            />
            <Tooltip content={<CustomTooltip locale={locale} t={t} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {changeKeys.map((key) => (
              <ReferenceLine
                key={key}
                x={key}
                yAxisId="price"
                stroke="var(--color-border-strong, #94a3b8)"
                strokeDasharray="4 4"
              />
            ))}
            <Line
              type="monotone"
              dataKey="currentPriceCents"
              yAxisId="price"
              stroke="var(--color-primary-solid, #0d9488)"
              strokeWidth={2.25}
              dot={{ r: 3, fill: 'var(--color-primary-solid, #0d9488)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={t('thisListingPrice')}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="otherPriceCents"
              yAxisId="price"
              stroke="var(--color-text-secondary, #64748b)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-text-secondary, #64748b)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={t('otherListingPrice')}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="currentMileage"
              yAxisId="mileage"
              stroke="var(--color-primary-text, #0f766e)"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-primary-text, #0f766e)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={t('thisListingMileage')}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="otherMileage"
              yAxisId="mileage"
              stroke="var(--color-text-placeholder, #94a3b8)"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-text-placeholder, #94a3b8)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={t('otherListingMileage')}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--clr-text-muted)' }}>
        {t('summary', { observations: history.length, listings: listingCount })}
      </p>
      <table className="sr-only">
        <caption>{t('caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('date')}</th>
            <th scope="col">{t('listing')}</th>
            <th scope="col">{t('metric')}</th>
            <th scope="col">{t('value')}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry, index) => (
            <tr key={`${entry.recordedAt}-${entry.listingId}-${entry.type}-${index}`}>
              <td>{formatLongDate(entry.recordedAt, locale)}</td>
              <td>{listingLabel(entry.listingId, currentListingId, t)}</td>
              <td>{entry.type === 'price' ? t('price') : t('mileage')}</td>
              <td>{entry.type === 'price' ? formatDollar(entry.value, locale) : formatMiles(entry.value, locale, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
