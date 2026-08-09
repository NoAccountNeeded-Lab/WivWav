import type { Listing } from '@wivwav/types'

/**
 * publicationStatus/qualityCheckedAt are DB-internal publication-gate fields,
 * not part of the public Listing shape — they are added here rather than in
 * @wivwav/types because only the ingestion pipeline needs to set them.
 * Optional: callers that do not validate before upsert (tests, older
 * adapters) fall back to the repository's default of 'pending'.
 *
 * Lives in this package (not apps/scraper) because it is the source
 * adapters' output contract: `ScrapeResult.listings` carries it, and the
 * adapters must stay importable without a database dependency (#948).
 * apps/scraper's engine/repositories.ts re-exports it unchanged.
 */
export type ListingUpsertData = Omit<
  Listing,
  'id' | 'scrapedAt' | 'updatedAt' | 'sourceListedAt' | 'sourceUpdatedAt'
> & {
  sourceListedAt?: Date | null
  sourceUpdatedAt?: Date | null
  publicationStatus?: 'pending' | 'eligible' | 'quarantined'
  qualityCheckedAt?: Date | null
  /**
   * #933 lineage backbone: the calling job's `JobRun` id (`context.runId`),
   * when run tracking is wired for the caller. Recorded on the listing as
   * `lastRunId` when this upsert actually creates or updates the row —
   * an `unchanged` outcome leaves the listing's prior `lastRunId` in place.
   */
  runId?: string | null | undefined
}

export type ListingUpsertResult = {
  listingId: string
  outcome: 'created' | 'updated' | 'unchanged'
  changedFields: string[]
}
