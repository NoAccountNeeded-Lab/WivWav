/**
 * Contract for `GET /internal/ops/helm-summary` (issue #1071): independent
 * listing-inventory observations for the /helm workspace.
 *
 * Every value counts listing rows or search documents — never unique
 * vehicles — and each is read separately, so the four values are NOT an
 * atomic snapshot and may legitimately diverge (the search index also holds
 * one representative document per vehicle group). A failed reading is
 * `{ value: null, availability: 'unavailable' }`, never a zero.
 */

export type HelmReadingAvailability = 'available' | 'unavailable'

export interface HelmCountReading {
  /** Row/document count, or null when the reading failed. */
  value: number | null
  availability: HelmReadingAvailability
  /** ISO time this reading finished; null when it failed. */
  collectedAt: string | null
}

export interface HelmInventoryCounts {
  /** All listing rows in the database, any status. */
  stored: HelmCountReading
  /** Listing rows with status `active` (observed active, any publication state). */
  active: HelmCountReading
  /** Active listing rows with publicationStatus `eligible`. */
  eligible: HelmCountReading
  /** Documents currently in the Meilisearch listing index. */
  indexed: HelmCountReading
}

export interface HelmSummary {
  /** ISO time the response was assembled, after all readings settled. */
  collectedAt: string
  counts: HelmInventoryCounts
  /** `database` is unavailable if any database reading failed. */
  availability: {
    database: HelmReadingAvailability
    search: HelmReadingAvailability
  }
}
