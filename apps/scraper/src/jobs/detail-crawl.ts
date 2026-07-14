import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import {
  fetchDetailPagesWithCrawlee,
  type DetailPageFetcher,
  type FetchedDetailPage,
} from './detail-fetcher.js'

const BATCH_SIZE = 50
const STALE_DETAIL_DAYS = 30

export async function runDetailCrawlJob(
  sourceId: string,
  context?: JobContext,
  fetchDetailPages: DetailPageFetcher = fetchDetailPagesWithCrawlee,
): Promise<void> {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('[detail-crawl] sourceId must be a non-empty string')
  }
  const db = getDb()

  const staleThreshold = new Date(Date.now() - STALE_DETAIL_DAYS * 24 * 60 * 60 * 1000)
  const listings = await db.listing.findMany({
    where: {
      sourceId,
      status: { not: 'gone' },
      OR: [
        { detailScrapedAt: null },
        { detailScrapedAt: { lt: staleThreshold } },
      ],
    },
    select: { sourceUrl: true },
    take: BATCH_SIZE,
    orderBy: { listedAt: 'asc' },
  })

  if (listings.length === 0) {
    await report(context, `[detail-crawl] No listings pending for source ${sourceId}`, {
      stage: 'complete',
      current: 0,
      total: 0,
    })
    await db.$disconnect()
    return
  }

  await report(context, `[detail-crawl] Crawling ${listings.length} pages for source ${sourceId}`, {
    stage: 'crawling',
    current: 0,
    total: listings.length,
  })

  let success = 0
  let failed = 0
  let processed = 0

  async function reportProcessed(): Promise<void> {
    processed++
    await report(context, `[detail-crawl] Processed ${processed}/${listings.length} page(s)`, {
      stage: 'crawling',
      current: processed,
      total: listings.length,
      success,
      failed,
    })
  }

  async function persistFetchedPage(page: FetchedDetailPage): Promise<void> {
    const { sourceUrl, finalUrl, statusCode, html } = page
    const is404 = statusCode === 404
    const isOffDomainRedirect =
      new URL(finalUrl).hostname !== new URL(sourceUrl).hostname

    if (is404 || isOffDomainRedirect) {
      // Authoritative gone signal — mark directly without waiting for extract.
      const goneListings = await db.listing.findMany({
        where: { sourceUrl, status: { not: 'gone' } },
        select: { id: true },
      })
      await db.listing.updateMany({
        where: { id: { in: goneListings.map((listing) => listing.id) } },
        data: { status: 'gone', goneAt: new Date() },
      })
      // Search-index sync remains the single-owner indexer poller's concern.
      await report(
        context,
        `[detail-crawl] ${is404 ? '404' : 'Off-domain redirect'} — marked ${sourceUrl} as gone`,
      )
    } else {
      await db.rawPage.upsert({
        where: { url: sourceUrl },
        // Reset processedAt so the extract job re-processes on re-crawl.
        update: { html, scrapedAt: new Date(), processedAt: null },
        create: { url: sourceUrl, sourceId, html },
      })
    }

    success++
    await reportProcessed()
  }

  try {
    await fetchDetailPages(
      listings.map((listing) => listing.sourceUrl),
      {
        onFetched: persistFetchedPage,
        async onFailed({ sourceUrl, error }): Promise<void> {
          failed++
          await report(context, `[detail-crawl] Failed ${sourceUrl}: ${error}`)
          await reportProcessed()
        },
      },
    )
  } finally {
    await db.$disconnect()
  }

  await report(context, `[detail-crawl] Done. ${success} crawled, ${failed} failed.`, {
    stage: 'complete',
    current: listings.length,
    total: listings.length,
  })
}
