import type { Listing, FieldMapping } from '@wivwav/types'
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
 * publicationStatus/qualityCheckedAt are DB-internal publication-gate fields,
 * not part of the public Listing shape — they are added here rather than in
 * @wivwav/types because only the ingestion pipeline (this repository) needs
 * to set them. Optional: callers that do not validate before upsert (tests,
 * older adapters) fall back to the repository's default of 'pending'.
 */
export type ListingUpsertData = Omit<
  Listing,
  'id' | 'scrapedAt' | 'updatedAt' | 'sourceListedAt' | 'sourceUpdatedAt'
> & {
  sourceListedAt?: Date | null
  sourceUpdatedAt?: Date | null
  publicationStatus?: 'pending' | 'eligible' | 'quarantined'
  qualityCheckedAt?: Date | null
}

export type ListingUpsertResult = {
  listingId: string
  outcome: 'created' | 'updated' | 'unchanged'
  changedFields: string[]
}

export interface PriceHistoryRow {
  id: string
  listingId: string
  priceCents: number
  recordedAt: Date
}

/**
 * How many consecutive complete crawls without an observation before a
 * possibly_gone listing is promoted to gone.
 *
 * Raised from 3 to 6 after a real incident (refs #618 investigation,
 * 2026-07-05): two back-to-back manual full crawls of BLVD.com landed
 * minutes apart, and the site's soft rate-limiting on the second crawl
 * returned a truncated result. 3885 legitimate listings took a miss on that
 * single degraded crawl; at the old threshold of 3, two more such crawls
 * (plausible during active dev/testing, or repeated site throttling) would
 * have permanently marked real, still-live inventory as gone. `gone` is not
 * auto-reversible even if the listing reappears later (see markGone).
 * 6 gives more headroom against transient scraper/site hiccups; revisit
 * post-launch once real production crawl reliability data exists.
 */
export const GONE_AFTER_CONSECUTIVE_MISSING = 6

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
  markGone(sourceId: string, activeSourceRecordKeys: string[], options: MarkGoneOptions): Promise<number>
}
