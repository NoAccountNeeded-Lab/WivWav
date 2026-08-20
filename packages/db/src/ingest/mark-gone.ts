import type { Prisma, PrismaClient } from '../generated/prisma/index.js'

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
 * auto-reversible even if the listing reappears later (see markGoneListings).
 * 6 gives more headroom against transient scraper/site hiccups; revisit
 * post-launch once real production crawl reliability data exists.
 */
export const GONE_AFTER_CONSECUTIVE_MISSING = 6

export interface MarkGoneListingsOptions {
  /** When true the crawl visited every page; missing listings count as evidence of removal. */
  isCompleteCrawl: boolean
  /**
   * Called with the ids of listings newly promoted to `gone` in this run, so
   * the caller can remove them from the search index immediately instead of
   * waiting on the next full-catalog rebuild. Must not throw — implementations
   * should catch and log/defer internally; markGoneListings does not retry or
   * swallow a rejection from this callback.
   */
  onGone?: (ids: string[]) => Promise<void>
}

/**
 * Soft-marks active listings absent from the crawled set (#948: shared by
 * apps/scraper's PrismaListingRepository and apps/api's worker-gateway
 * mark-gone endpoint — relocated verbatim from the scraper's
 * infrastructure/prisma-repositories.ts).
 *
 * - Incomplete crawl: only transitions active→possibly_gone; never increments
 *   missingFromCompleteCount and never promotes to gone.
 * - Complete crawl: increments missingFromCompleteCount for absent listings;
 *   promotes to gone when count reaches GONE_AFTER_CONSECUTIVE_MISSING.
 *   Resets missingFromCompleteCount to 0 for seen listings (reappearance).
 */
export interface MarkGoneListingsResult {
  /** Listings newly absent from the crawled set this run (see field docs above). */
  newlyMissingCount: number
  /**
   * Listings newly promoted from `possibly_gone` to `gone` this run (i.e.
   * missingFromCompleteCount reached GONE_AFTER_CONSECUTIVE_MISSING). Always
   * 0 for an incomplete crawl, since only complete crawls promote listings.
   */
  newlyGoneCount: number
}

export async function markGoneListings(
  db: PrismaClient | Prisma.TransactionClient,
  sourceId: string,
  activeSourceRecordKeys: string[],
  options: MarkGoneListingsOptions,
): Promise<MarkGoneListingsResult> {
  // Guard: if the scrape returned nothing, assume a scraper failure and leave status unchanged
  if (activeSourceRecordKeys.length === 0) return { newlyMissingCount: 0, newlyGoneCount: 0 }

  const { isCompleteCrawl, onGone } = options

  if (!isCompleteCrawl) {
    // Partial crawl (page-1 changed but we may have missed pages): soft-mark
    // active listings as possibly_gone without counting it as evidence.
    // missingFromCompleteCount is NOT incremented — only complete crawls provide
    // conclusive index-absence evidence.
    const result = await db.listing.updateMany({
      where: {
        sourceId,
        status: 'active',
        sourceRecordKey: { notIn: activeSourceRecordKeys },
      },
      data: { status: 'possibly_gone', detailScrapedAt: null },
    })
    return { newlyMissingCount: result.count, newlyGoneCount: 0 }
  }

  // Complete crawl path:
  // 1. Seen listings: reset missingFromCompleteCount and record lastSeenInCompleteCrawlAt.
  //    Also restore possibly_gone → active for listings that reappeared in the source index.
  const now = new Date()
  await db.listing.updateMany({
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
  await db.listing.updateMany({
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
  const newlyMissingCount = await db.listing.count({
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
  await db.listing.updateMany({
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
  // redundant work on every complete crawl. Without a callback, a plain count
  // still gives the caller the gone-promotion figure for ScraperRun tracking
  // (#986) without the extra id payload.
  const newlyGone = onGone
    ? await db.listing.findMany({ where: promoteWhere, select: { id: true } })
    : []
  const newlyGoneCount = onGone ? newlyGone.length : await db.listing.count({ where: promoteWhere })

  await db.listing.updateMany({
    where: promoteWhere,
    data: { status: 'gone', goneAt: now },
  })

  if (onGone && newlyGone.length > 0) {
    await onGone(newlyGone.map((l) => l.id))
  }

  return { newlyMissingCount, newlyGoneCount }
}
