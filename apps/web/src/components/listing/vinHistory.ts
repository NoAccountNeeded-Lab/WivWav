import type { VinHistoryEntry } from '@wivwav/types'
import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import { hasValueChange } from './hasValueChange'

export function hasMultiListingVinHistory(history: VinHistoryEntry[]): boolean {
  return new Set(history.map((entry) => entry.listingId)).size > 1
}

/** Values of one series (price or mileage) in a VIN history. */
export function vinSeriesValues(history: VinHistoryEntry[], type: VinHistoryEntry['type']): number[] {
  return history.filter((entry) => entry.type === type).map((entry) => entry.value)
}

/** Timeline is worth showing only across several listings with a price or mileage change. */
export function shouldShowVinHistory(history: VinHistoryEntry[]): boolean {
  return (
    hasMultiListingVinHistory(history) &&
    (hasValueChange(vinSeriesValues(history, 'price')) || hasValueChange(vinSeriesValues(history, 'mileage')))
  )
}

export interface ChartDatum {
  key: string
  label: string
  listingId: string
  listingLabel: string
  currentPriceCents: number | null
  otherPriceCents: number | null
  currentMileage: number | null
  otherMileage: number | null
}

function formatShortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { month: 'short', day: 'numeric' })
}

export function formatLongDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDollar(cents: number, locale: string): string {
  return `$${(cents / 100).toLocaleString(toIntlLocale(locale))}`
}

export function formatMiles(miles: number, locale: string, t: Translate): string {
  return t('miles', { miles: miles.toLocaleString(toIntlLocale(locale)) })
}

export function valueLabel(dataKey: string | undefined, value: number, locale: string, t: Translate): string {
  if (dataKey?.includes('Price')) return formatDollar(value, locale)
  return formatMiles(value, locale, t)
}

export function listingLabel(listingId: string, currentListingId: string, t: Translate): string {
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

interface SeriesAxis {
  show: boolean
  domain: [number, number]
}

export interface VinHistoryAxes {
  listingCount: number
  /** Chart-data keys where the history moves from one listing to another. */
  changeKeys: string[]
  price: SeriesAxis
  mileage: SeriesAxis
}

function seriesAxis(values: number[], round: (n: number, up: boolean) => number): SeriesAxis {
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 1000
  const padding = (max - min) * 0.15 || 1000
  return { show: hasValueChange(values), domain: [Math.max(0, round(min - padding, false)), round(max + padding, true)] }
}

/** Which series to draw, their padded axis domains, and where listings change. */
export function buildVinHistoryAxes(history: VinHistoryEntry[], data: ChartDatum[]): VinHistoryAxes {
  return {
    listingCount: new Set(history.map((entry) => entry.listingId)).size,
    changeKeys: data
      .filter((entry, index) => index > 0 && data[index - 1]?.listingId !== entry.listingId)
      .map((entry) => entry.key),
    // Price is in cents and rounded to whole dollars; mileage to whole miles.
    price: seriesAxis(vinSeriesValues(history, 'price'), (n, up) => (up ? Math.ceil(n / 100) : Math.floor(n / 100)) * 100),
    mileage: seriesAxis(vinSeriesValues(history, 'mileage'), (n, up) => (up ? Math.ceil(n) : Math.floor(n))),
  }
}
