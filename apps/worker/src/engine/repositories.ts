import type { FieldMapping } from '@wivwav/types'
import type { ListingUpsertData, ListingUpsertResult } from '@wivwav/scraper-sources'
import type { SourceDriftBaseline } from './listing-validator.js'

/**
 * Port interfaces the worker's `ScraperEngine` depends on (#952) — an
 * unchanged mirror of `apps/scraper/src/engine/repositories.ts`, so the
 * engine below is otherwise line-for-line the same code apps/scraper runs
 * in-process. Every implementation here (`../repositories-http/*.ts`) talks
 * HTTP to the coordinator's `/internal/scraper` gateway instead of Prisma.
 */

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
      isCompleteCrawl: boolean
    },
  ): Promise<void>
  markChecked(id: string): Promise<void>
  markError(id: string, errorMessage: string): Promise<void>
  markPaused(id: string, reason: string): Promise<void>
  getMappings(id: string): Promise<FieldMapping[]>
  setMappings(id: string, mappings: FieldMapping[]): Promise<void>
  getLastFullCrawlAt(id: string): Promise<Date | null>
  getDriftBaseline(id: string): Promise<SourceDriftBaseline | null>
  setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void>
}

export type { ListingUpsertData, ListingUpsertResult }

export interface MarkGoneOptions {
  isCompleteCrawl: boolean
}

export interface ListingRepository {
  upsert(listing: ListingUpsertData): Promise<ListingUpsertResult>
  markGone(
    sourceId: string,
    activeSourceRecordKeys: string[],
    options: MarkGoneOptions,
  ): Promise<number>
}
