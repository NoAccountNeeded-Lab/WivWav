import { SourceStatus, type PrismaClient, type Prisma } from '@wivwav/db'
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
import { markGoneListings } from '@wivwav/db'
import type { SourceDriftBaseline } from '../engine/listing-validator.js'
import { ingestListing } from '../application/listing-ingest.js'
import { recordCardFieldClaims } from '../resolution/card-claims.js'
import { withTransientRetry } from '../lib/db-retry.js'

/**
 * True for Prisma's "record not found" error (P2025). A Source row can be deleted
 * (or a stale scheduler/adapter can outlive a DB reseed) while a run is in flight —
 * treating this as a no-op instead of throwing keeps that case from crashing the
 * run or masking whatever error actually caused it to fail.
 */
function isRecordNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['code'] === 'P2025'
}

export class PrismaScraperRunRepository implements ScraperRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(sourceId: string): Promise<ScraperRunRecord> {
    return this.db.scraperRun.create({ data: { sourceId, startedAt: new Date() } })
  }

  async complete(
    id: string,
    listingsFound: number,
    changes: { listingsNew: number; listingsUpdated: number } = { listingsNew: 0, listingsUpdated: 0 },
  ): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: true, listingsFound, ...changes },
    })
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.db.scraperRun.update({
      where: { id },
      data: { finishedAt: new Date(), success: false, errorMessage },
    })
  }
}

export class PrismaSourceRepository implements SourceRepository {
  constructor(private readonly db: PrismaClient, private readonly logger?: WivWavLogger) {}

  /**
   * Wraps `source.update`, swallowing "record not found" (P2025) as a no-op
   * instead of throwing — see isRecordNotFoundError. Any other error still throws.
   */
  private async updateSource(id: string, data: Prisma.SourceUpdateInput): Promise<void> {
    try {
      await this.db.source.update({ where: { id }, data })
    } catch (err) {
      if (!isRecordNotFoundError(err)) throw err
      this.logger?.warn({ sourceId: id }, 'Skipped source update: source no longer exists')
    }
  }

  async getExecutionState(id: string): Promise<SourceExecutionState | null> {
    const source = await this.db.source.findUnique({
      where: { id },
      select: { status: true, errorMessage: true },
    })
    return source
  }

  async markNeedsRemapping(id: string, errorMessage = 'Structure changed — awaiting AI remap'): Promise<void> {
    await this.updateSource(id, { status: 'needs_remapping', errorMessage })
  }

  async markActive(id: string, data: { listingCount: number; fingerprintHash: string; page1Hash?: string; isCompleteCrawl: boolean }): Promise<void> {
    const now = new Date()
    const result = await this.db.source.updateMany({
      where: {
        id,
        status: { notIn: [SourceStatus.paused, SourceStatus.disabled] },
      },
      data: {
        lastScrapedAt: now,
        lastObservedAt: now,
        listingCount: data.listingCount,
        fingerprintHash: data.fingerprintHash,
        ...(data.page1Hash !== undefined ? { page1Hash: data.page1Hash } : {}),
        ...(data.isCompleteCrawl ? { lastFullCrawlAt: now } : {}),
        status: 'active',
        errorMessage: null,
      },
    })
    if (result.count === 0) {
      this.logger?.warn({ sourceId: id }, 'Skipped source activation because the source is paused or disabled')
    }
  }

  async markChecked(id: string): Promise<void> {
    const now = new Date()
    await this.updateSource(id, { lastCheckedAt: now, lastObservedAt: now })
    // Reset error status when a no-change check succeeds — the source is reachable
    await this.db.source.updateMany({ where: { id, status: 'error' }, data: { status: 'active', errorMessage: null } })
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.updateSource(id, { status: 'error', errorMessage })
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await this.updateSource(id, { status: 'paused', errorMessage: reason })
  }

  async getDriftBaseline(id: string): Promise<SourceDriftBaseline | null> {
    const source = await this.db.source.findUnique({
      where: { id },
      select: { baselineErrorRate: true, baselineMissingRate: true },
    })
    if (source?.baselineErrorRate == null || source.baselineMissingRate == null) return null
    return {
      baselineErrorRate: source.baselineErrorRate,
      baselineMissingRate: source.baselineMissingRate,
    }
  }

  async setDriftBaseline(id: string, baseline: SourceDriftBaseline): Promise<void> {
    await this.updateSource(id, {
      baselineErrorRate: baseline.baselineErrorRate,
      baselineMissingRate: baseline.baselineMissingRate,
    })
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    const source = await this.db.source.findUnique({ where: { id }, select: { mappings: true } })
    return (source?.mappings ?? []) as unknown as FieldMapping[]
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    // Prisma's Json type needs the double cast via unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.updateSource(id, { mappings: mappings as unknown as any })
  }

  async getLastFullCrawlAt(id: string): Promise<Date | null> {
    const source = await this.db.source.findUnique({ where: { id }, select: { lastFullCrawlAt: true } })
    return source?.lastFullCrawlAt ?? null
  }
}

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(listing: ListingUpsertData): Promise<ListingUpsertResult> {
    const result = await withTransientRetry(() => this.db.$transaction(
      (tx) => ingestListing(tx, listing),
      { isolationLevel: 'Serializable' },
    ))
    // #499: record an independent claim for whatever accessibility evidence
    // this card observed, then re-resolve. Deliberately its own transaction,
    // after the upsert commits — see card-claims.ts's docstring. A listing
    // whose card supplied no accessibility evidence this scrape (the common
    // case) short-circuits before touching the database again.
    await recordCardFieldClaims(this.db, result.listingId, listing)
    return result
  }

  async markGone(sourceId: string, activeSourceRecordKeys: string[], options: MarkGoneOptions): Promise<number> {
    // Relocated to @wivwav/db's markGoneListings (#951) so apps/api's worker
    // gateway shares the exact implementation; this class stays the scraper's
    // port adapter until the #948 cutover.
    return markGoneListings(this.db, sourceId, activeSourceRecordKeys, options)
  }
}
