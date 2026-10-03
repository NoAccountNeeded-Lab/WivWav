import type { VinHistoryEntry } from '@wivwav/types'

export function hasMultiListingVinHistory(history: VinHistoryEntry[]): boolean {
  return new Set(history.map((entry) => entry.listingId)).size > 1
}
