import type { Listing, FieldMapping } from '@wivwav/types'

export interface ScraperRunRecord {
  id: string
}

export interface ScraperRunRepository {
  start(sourceId: string): Promise<ScraperRunRecord>
  complete(id: string, listingsFound: number): Promise<void>
  fail(id: string, errorMessage: string): Promise<void>
}

export interface SourceRepository {
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
  getMappings(id: string): Promise<FieldMapping[]>
  setMappings(id: string, mappings: FieldMapping[]): Promise<void>
  /** Returns the timestamp of the most recent complete crawl, or null if none. */
  getLastFullCrawlAt(id: string): Promise<Date | null>
}

export type ListingUpsertData = Omit<Listing, 'id' | 'scrapedAt' | 'updatedAt'>

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
 * The value 3 balances tolerance for transient failures (one-off failures
 * should not permanently remove a listing) against staleness (a genuinely
 * removed listing should be confirmed gone within 3 complete crawl cycles).
 */
export const GONE_AFTER_CONSECUTIVE_MISSING = 3

export interface MarkGoneOptions {
  /** When true the crawl visited every page; missing listings count as evidence of removal. */
  isCompleteCrawl: boolean
}

export interface ListingRepository {
  upsert(listing: ListingUpsertData): Promise<void>
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
