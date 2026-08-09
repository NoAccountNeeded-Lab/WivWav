import type { FieldMapping } from '@wivwav/types'
import type { ListingUpsertData, ListingUpsertResult } from '@wivwav/scraper-sources'
import type { SourceDriftBaseline } from './listing-validator.js'

export interface ScraperRunRecord {
  id: string
}

export interface SourceExecutionState {
  status: 'active' | 'disabled' | 'paused' | 'error' | 'needs_remapping'
  errorMessage: string | null
}

export interface ScraperRunRepository {
  start(sourceId: string): Promise<ScraperRunRecord>
  complete(
    id: string,
    listingsFound: number,
    changes?: { listingsNew: number; listingsUpdated: number },
  ): Promise<void>
  fail(id: string, errorMessage: string): Promise<void>
}

export interface SourceRepository {
  getExecutionState(id: string): Promise<SourceExecutionState | null>
  markNeedsRemapping(id: string, errorMessage?: string): Promise<void>
  markActive(
    id: string,
    data: {
      listingCount: number
      fingerprintHash: string
      page1Hash?: string
      /** True when every page of the source was crawled in this run. */
      isCompleteCrawl: boolean
    },
  ): Promise<void>
  markChecked(id: string): Promise<void>
  markError(id: string, errorMessage: string): Promise<void>
  /** Pauses a source with an operator-facing reason (e.g. abrupt quality drift). */
  markPaused(id: string, reason: string): Promise<void>
  getMappings(id: string): Promise<FieldMapping[]>
  setMappings(id: string, mappings: FieldMapping[]): Promise<void>
  /** Returns the timestamp of the most recent complete crawl, or null if none. */
  getLastFullCrawlAt(id: string): Promise<Date | null>
  /** Returns the source's rolling drift baseline, or null if no run has completed yet. */
  getDriftBaseline(id: string): Promise<SourceDriftBaseline | null>
  /** Persists the updated rolling drift baseline after a run. */
  setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void>
}

/**
 * Relocated to @wivwav/scraper-sources (#950): ListingUpsertData is the
 * source adapters' output contract (`ScrapeResult.listings`), so it lives
 * with them, where no @wivwav/db dependency is allowed. Re-exported here so
 * every existing engine/infrastructure import keeps working until the #948
 * cutover.
 */
export type { ListingUpsertData, ListingUpsertResult }

export interface PriceHistoryRow {
  id: string
  listingId: string
  priceCents: number
  recordedAt: Date
}

// Relocated to @wivwav/db (#951) alongside the shared markGoneListings
// implementation; re-exported so existing imports keep working until cutover.
export { GONE_AFTER_CONSECUTIVE_MISSING } from '@wivwav/db'

export interface MarkGoneOptions {
  /** When true the crawl visited every page; missing listings count as evidence of removal. */
  isCompleteCrawl: boolean
  /**
   * Called with the ids of listings newly promoted to `gone` in this run, so
   * the caller can remove them from the search index immediately instead of
   * waiting on the next full-catalog rebuild. Must not throw — implementations
   * should catch and log/defer internally; markGone does not retry or swallow
   * a rejection from this callback.
   */
  onGone?: (ids: string[]) => Promise<void>
}

export interface ListingRepository {
  upsert(listing: ListingUpsertData): Promise<ListingUpsertResult>
  /**
   * Soft-marks active listings absent from the crawled set.
   *
   * - Incomplete crawl: only transitions active→possibly_gone; never increments
   *   missingFromCompleteCount and never promotes to gone.
   * - Complete crawl: increments missingFromCompleteCount for absent listings;
   *   promotes to gone when count reaches GONE_AFTER_CONSECUTIVE_MISSING.
   *   Resets missingFromCompleteCount to 0 for seen listings (reappearance).
   */
  markGone(
    sourceId: string,
    activeSourceRecordKeys: string[],
    options: MarkGoneOptions,
  ): Promise<number>
}
