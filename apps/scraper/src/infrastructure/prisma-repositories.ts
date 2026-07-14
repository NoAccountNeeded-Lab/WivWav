import type { PrismaClient } from '@wivwav/db'
import type { FieldMapping } from '@wivwav/types'
import type {
  ScraperRunRepository,
  ScraperRunRecord,
  SourceRepository,
  ListingRepository,
  ListingUpsertData,
  ListingUpsertResult,
  MarkGoneOptions,
} from '../engine/repositories.js'
import { GONE_AFTER_CONSECUTIVE_MISSING } from '../engine/repositories.js'
import type { SourceDriftBaseline } from '../engine/listing-validator.js'
import { ingestListing } from '../application/listing-ingest.js'
import { recordCardFieldClaims } from '../resolution/card-claims.js'

const TRANSIENT_PRISMA_CODES = new Set(['P2002', 'P2028', 'P2034', 'P1001', 'P1002', 'P1008', 'P1017'])
const TRANSIENT_DB_MESSAGES = ['connection closed', 'connection reset', 'transaction already closed']

/**
 * Returns true for Prisma errors that represent transient connection or transaction
 * failures that are safe to retry: concurrent create/write conflicts P2002/P2034,
 * P2028 (transaction already closed), and connection errors P1001/P1002/P1008/P1017.
 */
function isTransientPrismaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>)['code']
  if (typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)) return true
  const message = (err as Record<string, unknown>)['message']
  if (typeof message === 'string') {
    const lower = message.toLowerCase()
    return TRANSIENT_DB_MESSAGES.some((fragment) => lower.includes(fragment))
  }
  return false
}

/**
 * Runs `fn` up to `maxAttempts` times, retrying only on transient Prisma errors.
 * Uses exponential backoff starting at `baseDelayMs`.
 */
async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err: unknown) {
      attempt++
      if (!isTransientPrismaError(err) || attempt >= maxAttempts) throw err
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)))
    }
  }
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
  constructor(private readonly db: PrismaClient) {}

  async markNeedsRemapping(id: string, errorMessage = 'Structure changed — awaiting AI remap'): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'needs_remapping', errorMessage },
    })
  }

  async markActive(id: string, data: { listingCount: number; fingerprintHash: string; page1Hash?: string; isCompleteCrawl: boolean }): Promise<void> {
    const now = new Date()
    await this.db.source.update({
      where: { id },
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
  }

  async markChecked(id: string): Promise<void> {
    const now = new Date()
    await this.db.source.update({ where: { id }, data: { lastCheckedAt: now, lastObservedAt: now } })
    // Reset error status when a no-change check succeeds — the source is reachable
    await this.db.source.updateMany({ where: { id, status: 'error' }, data: { status: 'active', errorMessage: null } })
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'error', errorMessage },
    })
  }

  async markPaused(id: string, reason: string): Promise<void> {
    await this.db.source.update({
      where: { id },
      data: { status: 'paused', errorMessage: reason },
    })
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
    await this.db.source.update({
      where: { id },
      data: {
        baselineErrorRate: baseline.baselineErrorRate,
        baselineMissingRate: baseline.baselineMissingRate,
      },
    })
  }

  async getMappings(id: string): Promise<FieldMapping[]> {
    const source = await this.db.source.findUnique({ where: { id }, select: { mappings: true } })
    return (source?.mappings ?? []) as unknown as FieldMapping[]
  }

  async setMappings(id: string, mappings: FieldMapping[]): Promise<void> {
    // Prisma's Json type needs the double cast via unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.source.update({ where: { id }, data: { mappings: mappings as unknown as any } })
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
    // Guard: if the scrape returned nothing, assume a scraper failure and leave status unchanged
    if (activeSourceRecordKeys.length === 0) return 0

    const { isCompleteCrawl, onGone } = options

    if (!isCompleteCrawl) {
      // Partial crawl (page-1 changed but we may have missed pages): soft-mark
      // active listings as possibly_gone without counting it as evidence.
      // missingFromCompleteCount is NOT incremented — only complete crawls provide
      // conclusive index-absence evidence.
      const result = await this.db.listing.updateMany({
        where: {
          sourceId,
          status: 'active',
          sourceRecordKey: { notIn: activeSourceRecordKeys },
        },
        data: { status: 'possibly_gone', detailScrapedAt: null },
      })
      return result.count
    }

    // Complete crawl path:
    // 1. Seen listings: reset missingFromCompleteCount and record lastSeenInCompleteCrawlAt.
    //    Also restore possibly_gone → active for listings that reappeared in the source index.
    const now = new Date()
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: 'possibly_gone',
        sourceRecordKey: { in: activeSourceRecordKeys },
      },
      data: {
        missingFromCompleteCount: 0,
        lastSeenInCompleteCrawlAt: now,
        status: 'active',
        goneAt: null,
        detailScrapedAt: null,
      },
    })

    // Update lastSeenInCompleteCrawlAt for all seen non-gone listings
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: { not: 'gone' },
        sourceRecordKey: { in: activeSourceRecordKeys },
      },
      data: { lastSeenInCompleteCrawlAt: now, missingFromCompleteCount: 0 },
    })

    // 2. Count how many active listings are newly absent (before updating status).
    //    This is the "newly missing" count returned to the caller for logging.
    //    We count before the update so we have the pre-transition number.
    const newlyMissingCount = await this.db.listing.count({
      where: {
        sourceId,
        status: 'active',
        sourceRecordKey: { notIn: activeSourceRecordKeys },
      },
    })

    // 3. Increment missingFromCompleteCount for ALL absent non-gone listings
    //    (both active and already-possibly_gone) in a single UPDATE, below the
    //    threshold cap. Active listings also transition to possibly_gone here.
    //
    //    This single query prevents a double-increment that would occur if two
    //    separate UPDATEs ran: step A writing active→possibly_gone with count=1,
    //    then step B matching the now-possibly_gone rows and incrementing again
    //    to count=2 in the same run.
    await this.db.listing.updateMany({
      where: {
        sourceId,
        status: { in: ['active', 'possibly_gone'] },
        sourceRecordKey: { notIn: activeSourceRecordKeys },
        missingFromCompleteCount: { lt: GONE_AFTER_CONSECUTIVE_MISSING },
      },
      data: {
        status: 'possibly_gone',
        detailScrapedAt: null,
        missingFromCompleteCount: { increment: 1 },
      },
    })

    // 4. Promote to gone when the threshold is reached.
    const promoteWhere = {
      sourceId,
      status: 'possibly_gone' as const,
      sourceRecordKey: { notIn: activeSourceRecordKeys },
      missingFromCompleteCount: { gte: GONE_AFTER_CONSECUTIVE_MISSING },
    }

    // Only look up the ids when a caller wants them — this query is otherwise
    // redundant work on every complete crawl.
    const newlyGone = onGone
      ? await this.db.listing.findMany({ where: promoteWhere, select: { id: true } })
      : []

    await this.db.listing.updateMany({
      where: promoteWhere,
      data: { status: 'gone', goneAt: now },
    })

    if (onGone && newlyGone.length > 0) {
      await onGone(newlyGone.map((l) => l.id))
    }

    return newlyMissingCount
  }
}
