import { type PrismaClient } from '@wivwav/db'
import type { WivWavLogger } from '@wivwav/logger'
import type { FieldMapping } from '@wivwav/types'
import type {
  ScraperRunRepository,
  ScraperRunRecord,
  SourceRepository,
  SourceExecutionState,
  ListingRepository,
  ListingUpsertData,
  ListingUpsertResult,
  MarkGoneOptions,
} from '../engine/repositories.js'
import {
  markGoneListings,
  startScraperRun,
  completeScraperRun,
  failScraperRun,
  getSourceExecutionState,
  getSourceDriftBaseline,
  getSourceLastFullCrawlAt,
  getSourceMappings,
  markSourceActive,
  markSourceChecked,
  markSourceError,
  markSourceNeedsRemapping,
  markSourcePaused,
  setSourceDriftBaseline,
  setSourceMappings,
} from '@wivwav/db'
import type { SourceDriftBaseline } from '../engine/listing-validator.js'
import { ingestListing } from '../application/listing-ingest.js'
import { recordCardFieldClaims } from '../resolution/card-claims.js'
import { withTransientRetry } from '../lib/db-retry.js'

/**
 * Relocated to @wivwav/db (#951) alongside every other write in this file —
 * these classes are now thin adapters onto the shared functions so
 * apps/api's worker gateway and this scraper daemon share one
 * implementation until the #948 cutover deletes this file.
 */
export class PrismaScraperRunRepository implements ScraperRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<ScraperRunRecord> {
    return startScraperRun(this.db, sourceId)
  }

  async complete(
    id: string,
    listingsFound: number,
    changes?: { listingsNew: number; listingsUpdated: number },
  ): Promise<void> {
    await completeScraperRun(this.db, id, listingsFound, changes)
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await failScraperRun(this.db, id, errorMessage)
  }
}

export class PrismaSourceRepository implements SourceRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: WivWavLogger,
  ) {}

  async getExecutionState(id: string): Promise<SourceExecutionState | null> {
    return getSourceExecutionState(this.db, id)
  }

  async markNeedsRemapping(id: string, errorMessage?: string): Promise<void> {
    await markSourceNeedsRemapping(this.db, id, errorMessage, this.logger)
  }

  async markActive(
    id: string,
    data: {
      listingCount: number
      fingerprintHash: string
      page1Hash?: string
      isCompleteCrawl: boolean
    },
  ): Promise<void> {
    await markSourceActive(this.db, id, data, this.logger)
  }

  async markChecked(id: string): Promise<void> {
    await markSourceChecked(this.db, id, this.logger)
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await markSourceError(this.db, id, errorMessage, this.logger)
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await markSourcePaused(this.db, id, reason, this.logger)
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline | null> {
    return getSourceDriftBaseline(this.db, id)
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await setSourceDriftBaseline(this.db, id, baseline, this.logger)
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    return getSourceMappings(this.db, id)
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    await setSourceMappings(this.db, id, mappings, this.logger)
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    return getSourceLastFullCrawlAt(this.db, id)
  }
}

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(listing: ListingUpsertData): Promise<ListingUpsertResult> {
    const result = await withTransientRetry(() =>
      this.db.$transaction((tx) => ingestListing(tx, listing), { isolationLevel: 'Serializable' }),
    )
    // #499: record an independent claim for whatever accessibility evidence
    // this card observed, then re-resolve. Deliberately its own transaction,
    // after the upsert commits — see card-claims.ts's docstring. A listing
    // whose card supplied no accessibility evidence this scrape (the common
    // case) short-circuits before touching the database again.
    await recordCardFieldClaims(this.db, result.listingId, listing)
    return result
  }

  async markGone(
    sourceId: string,
    activeSourceRecordKeys: string[],
    options: MarkGoneOptions,
  ): Promise<number> {
    // Relocated to @wivwav/db's markGoneListings (#951) so apps/api's worker
    // gateway shares the exact implementation; this class stays the scraper's
    // port adapter until the #948 cutover.
    return markGoneListings(this.db, sourceId, activeSourceRecordKeys, options)
  }
}
