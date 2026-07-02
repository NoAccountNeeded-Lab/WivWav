import { getDb } from '@wivwav/db'
import type { JobContext, QueueAdapter } from '@wivwav/queue'
import { CRITICAL_JOB_OPTIONS, LISTING_SYNC_REBUILD_JOB_ID } from '@wivwav/queue'
import { syncListings } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import type { BrowserService } from '../browser/index.js'
import { report } from './job-progress.js'
import { jitteredSleep } from '../util/jitter-sleep.js'

const BATCH_SIZE = 50
const RATE_LIMIT_MS = 2000
const STALE_DETAIL_DAYS = 30


export async function runDetailCrawlJob(
  sourceId: string,
  context?: JobContext,
  listingSyncQueue?: QueueAdapter,
  browserService?: BrowserService,
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
    select: { sourceUrl: true, status: true },
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

  // Lazy import so callers that inject MockBrowserService never trigger a
  // real Playwright import at all.
  const { PlaywrightBrowserService } = await import('../browser/index.js')
  const service = browserService ?? new PlaywrightBrowserService()
  const browser = await service.launch()
  let success = 0
  let failed = 0

  try {
    for (let i = 0; i < listings.length; i++) {
      const { sourceUrl, status } = listings[i]!
      const page = await browser.newPage()

      try {
        let response: { status(): number } | null = null
        let navFailed = false

        try {
          // networkidle ensures the description text (loaded async) is present before we store
          response = await page.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 45_000 })
        } catch (navErr) {
          // Transient network/timeout failure — leave possibly_gone for the next crawl to retry
          navFailed = true
          await report(context, `[detail-crawl] Navigation error ${sourceUrl}: ${navErr}`)
          if (status !== 'possibly_gone') failed++
        }

        if (!navFailed) {
          const finalUrl = page.url()
          const is404 = response !== null && response.status() === 404
          const isOffDomainRedirect =
            new URL(finalUrl).hostname !== new URL(sourceUrl).hostname

          if (is404 || isOffDomainRedirect) {
            // Authoritative gone signal — mark directly without waiting for extract
            const goneListings = await db.listing.findMany({
              where: { sourceUrl, status: { not: 'gone' } },
              select: { id: true },
            })
            await db.listing.updateMany({
              where: { id: { in: goneListings.map((l) => l.id) } },
              data: { status: 'gone', goneAt: new Date() },
            })
            // Remove the now-gone listing(s) from Meilisearch immediately, rather
            // than waiting on the queued full-catalog rebuild, so it stops
            // surfacing in search the moment it's confirmed gone.
            if (goneListings.length > 0) {
              try {
                await syncListings(goneListings.map((l) => l.id), db, getMeiliClient())
              } catch (syncErr) {
                context?.logger?.error({ err: syncErr, sourceUrl }, '[detail-crawl] Meilisearch sync failed — deferring to listing-sync queue')
                await report(context, `[detail-crawl] Meilisearch sync failed for ${sourceUrl}, deferring to listing-sync queue: ${syncErr}`)
                if (listingSyncQueue !== undefined) {
                  try {
                    await listingSyncQueue.add({}, { ...CRITICAL_JOB_OPTIONS, jobId: LISTING_SYNC_REBUILD_JOB_ID })
                  } catch (enqueueErr) {
                    context?.logger?.error(
                      { err: enqueueErr, sourceUrl },
                      '[detail-crawl] Failed to enqueue listing-sync job',
                    )
                    await report(context, `[detail-crawl] Failed to enqueue listing-sync job: ${enqueueErr}`)
                  }
                }
              }
            }
            await report(context, `[detail-crawl] ${is404 ? '404' : 'Off-domain redirect'} — marked ${sourceUrl} as gone`)
          } else {
            const html = await page.content()
            await db.rawPage.upsert({
              where: { url: sourceUrl },
              // Reset processedAt so the extract job re-processes on re-crawl
              update: { html, scrapedAt: new Date(), processedAt: null },
              create: { url: sourceUrl, sourceId, html },
            })
          }
          success++
        }
      } catch (err) {
        await report(context, `[detail-crawl] Failed ${sourceUrl}: ${err}`)
        failed++
      } finally {
        await page.close()
      }

      await report(context, `[detail-crawl] Processed ${i + 1}/${listings.length} page(s)`, {
        stage: 'crawling',
        current: i + 1,
        total: listings.length,
      })

      if (i < listings.length - 1) await jitteredSleep(RATE_LIMIT_MS)
    }
  } finally {
    await browser.close()
    await db.$disconnect()
  }

  await report(context, `[detail-crawl] Done. ${success} crawled, ${failed} failed.`, {
    stage: 'complete',
    current: listings.length,
    total: listings.length,
  })
}
