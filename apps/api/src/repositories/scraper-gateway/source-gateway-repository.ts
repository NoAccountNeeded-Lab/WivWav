import {
  getSourceDriftBaseline,
  getSourceExecutionState,
  getSourceLastFullCrawlAt,
  getSourceMappings,
  markSourceActive,
  markSourceChecked,
  markSourceError,
  markSourceNeedsRemapping,
  markSourcePaused,
  setSourceDriftBaseline,
  setSourceMappings,
  type PrismaClient,
  type SourceDriftBaseline,
  type SourceExecutionState,
} from '@wivwav/db'
import type { WivWavLogger } from '@wivwav/logger'
import type { FieldMapping } from '@wivwav/types'

export type { SourceDriftBaseline, SourceExecutionState }

/**
 * Source-state transitions for the worker gateway (#951). Deliberately a
 * separate class from the admin-oriented SourceRepository in
 * ../source-repository.ts — same table, different surface — but both this
 * class and apps/scraper's PrismaSourceRepository delegate to the one
 * shared implementation in @wivwav/db.
 */
export class SourceGatewayRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: WivWavLogger,
  ) {}

  async getExecutionState(id: string): Promise<SourceExecutionState | null> {
    return getSourceExecutionState(this.db, id)
  }

  /**
   * The fields a worker needs to construct a `SourceAdapter` for a dispatched
   * SOURCE_SCRAPE job (#952): the dispatch payload carries only `sourceId`, so
   * the worker resolves the registry adapter module via `name` (matched
   * against `@wivwav/types`' `SCRAPER_SOURCE_REGISTRY`, which has no DB
   * dependency) and seeds the adapter's change-detection state from
   * `fingerprintHash`/`page1Hash` — the same fields
   * `apps/scraper/src/sources/registry.ts`'s `registerSources` reads to build
   * the in-process adapter.
   */
  async getProfile(id: string): Promise<{
    id: string
    name: string
    baseUrl: string
    fingerprintHash: string | null
    page1Hash: string | null
  } | null> {
    const source = await this.db.source.findUnique({
      where: { id },
      select: { id: true, name: true, baseUrl: true, fingerprintHash: true, page1Hash: true },
    })
    return source
  }

  async markNeedsRemapping(id: string, errorMessage?: string): Promise<void> {
    await markSourceNeedsRemapping(this.db, id, errorMessage, this.logger)
  }

  async markActive(
    id: string,
    data: {
      listingCount: number
      fingerprintHash: string
      page1Hash?: string | undefined
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

  async getMappings(id: string): Promise<FieldMapping[]> {
    return getSourceMappings(this.db, id)
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    await setSourceMappings(this.db, id, mappings, this.logger)
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    return getSourceLastFullCrawlAt(this.db, id)
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline | null> {
    return getSourceDriftBaseline(this.db, id)
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await setSourceDriftBaseline(this.db, id, baseline, this.logger)
  }
}
