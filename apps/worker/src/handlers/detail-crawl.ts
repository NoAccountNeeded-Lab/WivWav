import { jitteredSleep, report } from '@wivwav/scraper-sources'
import type { BrowserService } from '@wivwav/scraper-sources/browser/types.js'
import type { WivWavLogger } from '@wivwav/logger'
import type { ScraperGatewayClient } from '../scraper-gateway-client.js'
import { createJobContext } from '../job-context.js'

const BATCH_SIZE = 50
const RATE_LIMIT_MS = 2000

export interface DetailCrawlPayload {
  sourceId: string
}

function isDetailCrawlPayload(payload: unknown): payload is DetailCrawlPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)['sourceId'] === 'string'
  )
}

/**
 * DETAIL_CRAWL handler (#952): ported from `apps/scraper/src/jobs/detail-crawl.ts`
 * with every `db.*` call replaced by an HTTP call to the coordinator's
 * `/internal/scraper` gateway. Behavior is otherwise unchanged: 404/off-domain
 * redirects mark the listing gone immediately; a successful fetch upserts the
 * raw HTML for detail-extract to pick up.
 */
export function createDetailCrawlHandler(
  gateway: ScraperGatewayClient,
  browserService: BrowserService,
  logger: WivWavLogger,
) {
  return async (payload: unknown, correlationId: string): Promise<void> => {
    if (!isDetailCrawlPayload(payload)) {
      throw new Error('[detail-crawl] payload must be { sourceId: string }')
    }
    const { sourceId } = payload
    const context = createJobContext(logger, correlationId)

    const { state } = await gateway.getExecutionState(sourceId)
    const blockReason = state && (state.status === 'disabled' || state.status === 'paused')
      ? state.errorMessage ?? `Source is ${state.status}`
      : null
    if (blockReason !== null) {
      await report(context, `[detail-crawl] Skipped source ${sourceId}: ${blockReason}`, {
        stage: 'blocked',
        reason: 'source_disabled',
        current: 0,
        total: 0,
      })
      return
    }

    const { listings } = await gateway.getDetailCrawlPendingListings(sourceId, BATCH_SIZE)
    if (listings.length === 0) {
      await report(context, `[detail-crawl] No listings pending for source ${sourceId}`, {
        stage: 'complete',
        current: 0,
        total: 0,
      })
      return
    }

    await report(context, `[detail-crawl] Crawling ${listings.length} pages for source ${sourceId}`, {
      stage: 'crawling',
      current: 0,
      total: listings.length,
    })

    const browser = await browserService.launch()
    let success = 0
    let failed = 0

    try {
      for (let i = 0; i < listings.length; i++) {
        const { state: midRunState } = await gateway.getExecutionState(sourceId)
        const midRunBlockReason = midRunState && (midRunState.status === 'disabled' || midRunState.status === 'paused')
          ? midRunState.errorMessage ?? `Source is ${midRunState.status}`
          : null
        if (midRunBlockReason !== null) {
          await report(context, `[detail-crawl] Stopped source ${sourceId}: ${midRunBlockReason}`, {
            stage: 'blocked',
            reason: 'source_disabled_mid_run',
            current: i,
            total: listings.length,
          })
          break
        }

        const { sourceUrl, status } = listings[i]!
        const page = await browser.newPage()

        try {
          let response: { status(): number } | null = null
          let navFailed = false

          try {
            response = await page.goto(sourceUrl, { waitUntil: 'networkidle', timeout: 45_000 })
          } catch (navErr) {
            navFailed = true
            await report(context, `[detail-crawl] Navigation error ${sourceUrl}: ${String(navErr)}`)
            if (status !== 'possibly_gone') failed++
          }

          if (!navFailed) {
            const finalUrl = page.url()
            const is404 = response !== null && response.status() === 404
            const isOffDomainRedirect = new URL(finalUrl).hostname !== new URL(sourceUrl).hostname

            if (is404 || isOffDomainRedirect) {
              await gateway.markGoneByUrl(sourceUrl)
              await report(context, `[detail-crawl] ${is404 ? '404' : 'Off-domain redirect'} — marked ${sourceUrl} as gone`)
            } else {
              const html = await page.content()
              await gateway.upsertRawPage(sourceId, sourceUrl, html)
            }
            success++
          }
        } catch (err) {
          await report(context, `[detail-crawl] Failed ${sourceUrl}: ${String(err)}`)
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
    }

    await report(context, `[detail-crawl] Done. ${success} crawled, ${failed} failed.`, {
      stage: 'complete',
      current: listings.length,
      total: listings.length,
    })
  }
}
