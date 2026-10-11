import type { VinHistoryEntry } from '@wivwav/types'
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
