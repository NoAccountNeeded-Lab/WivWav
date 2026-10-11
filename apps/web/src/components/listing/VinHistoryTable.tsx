import type { VinHistoryEntry } from '@wivwav/types'
import type { Translate } from '@/lib/intl'
import { formatDollar, formatLongDate, formatMiles, listingLabel } from './vinHistory'

interface VinHistoryTableProps {
  entries: VinHistoryEntry[]
  currentListingId: string
  locale: string
  t: Translate
}

/** Screen-reader equivalent of the chart; `entries` is already limited to the visible series. */
export function VinHistoryTable({ entries, currentListingId, locale, t }: VinHistoryTableProps) {
  return (
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
        {entries.map((entry, index) => (
          <tr key={`${entry.recordedAt}-${entry.listingId}-${entry.type}-${index}`}>
            <td>{formatLongDate(entry.recordedAt, locale)}</td>
            <td>{listingLabel(entry.listingId, currentListingId, t)}</td>
            <td>{entry.type === 'price' ? t('price') : t('mileage')}</td>
            <td>{entry.type === 'price' ? formatDollar(entry.value, locale) : formatMiles(entry.value, locale, t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
