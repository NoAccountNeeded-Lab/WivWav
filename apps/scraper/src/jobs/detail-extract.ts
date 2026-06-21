import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import type { RampType, SaleStatus, WavFeature } from '@wivwav/types'
import { syncListings } from '@wivwav/search'
import type { BrowserPage, BrowserService } from '../browser/index.js'
import { evaluateBlvdDetail, parseBlvdDetail } from '../sources/blvd-detail.js'
import {
  createRateLimitedFetcher,
  enrichBlvdDealerListing,
  fetchHtml,
  type BlvdDealerEnrichment,
} from '../sources/blvd-dealer-enrichment.js'
import { evaluateMwDetail, parseMwDetail } from '../sources/mobilityworks-detail.js'
import { getMeiliClient } from '../lib/meili.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 100

type ListingStatus = 'active' | 'possibly_gone' | 'gone'

export type StatusUpdate =
  | { status: 'gone'; goneAt: Date; soldAt?: Date }
  | { status: 'active'; goneAt: null }
  | Record<string, never>

/**
 * Derives the ListingStatus update fields from the current listing state and
 * the sale status parsed from the detail page.
 *
 * Rules:
 * - sold banner on any non-gone listing → gone (+ soldAt on first confirmation)
 * - gone/unavailable banner on any non-gone listing → gone without soldAt
 * - pending banner on possibly_gone → restore to active (listing still live, just under contract)
 * - pending banner on active → no status change (stays visible in search with saleStatus label)
 * - possibly_gone + no banner → restore to active (confirmed still live)
 * - active + no banner (stale refresh) → no status change
 */
export function resolveListingStatus(
  currentStatus: ListingStatus,
  saleStatus: SaleStatus,
  existingSoldAt: Date | null,
  now: Date,
): StatusUpdate {
  if ((saleStatus === 'sold' || saleStatus === 'gone') && currentStatus !== 'gone') {
    return {
      status: 'gone',
      goneAt: now,
      ...(saleStatus === 'sold' && existingSoldAt == null ? { soldAt: now } : {}),
    }
  }
  if (currentStatus === 'possibly_gone' && saleStatus !== 'sold') {
    // Pending banner means the listing is still live (just under contract); restore it.
    // No banner also means it's still live.
    return { status: 'active', goneAt: null }
  }
  return {}
}

export type DetailResult = {
  color: string | null
  fuelType: string | null
  transmission: string | null
  rampType: RampType
  wavFeatures: WavFeature[]
  floorLoweringInches: number | null
  wheelchairCapacity: number | null
  description: string | null
  images: string[]
  zip: string | null
  dealerPhone: string | null
  saleStatus: SaleStatus
}

export function buildListingDetailUpdateData(
  detail: DetailResult,
  enrichment: BlvdDealerEnrichment,
  statusUpdate: StatusUpdate,
  now: Date,
) {
  return {
    color: detail.color,
    fuelType: detail.fuelType,
    transmission: detail.transmission,
    rampType: detail.rampType,
    wavFeatures: detail.wavFeatures,
    floorLoweringInches: detail.floorLoweringInches,
    wheelchairCapacity: detail.wheelchairCapacity,
    description: detail.description,
    ...(detail.images.length > 0 && { images: detail.images }),
    ...(detail.zip && { zip: detail.zip }),
    ...(detail.dealerPhone && { dealerPhone: detail.dealerPhone }),
    ...(enrichment.dealerWebsite && { dealerWebsite: enrichment.dealerWebsite }),
    ...(enrichment.directVehicleUrl && { buyerUrl: enrichment.directVehicleUrl }),
    saleStatus: detail.saleStatus,
    ...statusUpdate,
    detailScrapedAt: now,
  }
}

async function extractDetail(page: BrowserPage, url: string): Promise<DetailResult> {
  if (url.includes('mobilityworks.com')) {
    const raw = await evaluateMwDetail(page)
    return parseMwDetail(raw)
  }
  const raw = await evaluateBlvdDetail(page)
  return parseBlvdDetail(raw)
}

export async function runDetailExtractJob(
  sourceId: string,
  context?: JobContext,
  browserService?: BrowserService,
): Promise<void> {
  const db = getDb()

  const rawPages = await db.rawPage.findMany({
    where: { sourceId, processedAt: null },
    select: { id: true, url: true, html: true },
    take: BATCH_SIZE,
  })

  if (rawPages.length === 0) {
    await report(context, `[detail-extract] No raw pages pending for source ${sourceId}`, {
      stage: 'complete',
      current: 0,
      total: 0,
    })
    await db.$disconnect()
    return
  }

  await report(context, `[detail-extract] Extracting ${rawPages.length} raw pages for source ${sourceId}`, {
    stage: 'extracting',
    current: 0,
    total: rawPages.length,
  })

  // Lazy import so callers that inject MockBrowserService never trigger a
  // real Playwright import at all.
  const { PlaywrightBrowserService } = await import('../browser/index.js')
  const service = browserService ?? new PlaywrightBrowserService()
  const browser = await service.launch()
  const fetchDealerPage = createRateLimitedFetcher(fetchHtml)
  let success = 0
  let failed = 0

  try {
    for (let i = 0; i < rawPages.length; i++) {
      const rawPage = rawPages[i]!
      const page = await browser.newPage()

      try {
        await page.setContent(rawPage.html, { waitUntil: 'domcontentloaded' })
        const detail = await extractDetail(page, rawPage.url)

        const listing = await db.listing.findFirst({
          where: { sourceUrl: rawPage.url },
          select: { id: true, status: true, soldAt: true, vin: true },
        })

        if (listing) {
          const now = new Date()
          const statusUpdate = resolveListingStatus(
            listing.status as ListingStatus,
            detail.saleStatus,
            listing.soldAt,
            now,
          )
          const enrichment = await enrichBlvdDealerListing({
            sourceUrl: rawPage.url,
            vin: listing.vin,
            fetchPage: fetchDealerPage,
            log: (message) => report(context, message),
          })

          await db.listing.update({
            where: { id: listing.id },
            data: buildListingDetailUpdateData(detail, enrichment, statusUpdate, now),
          })
          await syncListings([listing.id], db, getMeiliClient())
        } else {
          await report(context, `[detail-extract] No listing found for URL: ${rawPage.url}`)
        }

        await db.rawPage.update({
          where: { id: rawPage.id },
          data: { processedAt: new Date() },
        })

        success++
      } catch (err) {
        await report(context, `[detail-extract] Failed ${rawPage.url}: ${err}`)
        failed++
      } finally {
        await page.close()
      }

      await report(context, `[detail-extract] Processed ${i + 1}/${rawPages.length} raw page(s)`, {
        stage: 'extracting',
        current: i + 1,
        total: rawPages.length,
      })
    }
  } finally {
    await browser.close()
    await db.$disconnect()
  }

  await report(context, `[detail-extract] Done. ${success} extracted, ${failed} failed.`, {
    stage: 'complete',
    current: rawPages.length,
    total: rawPages.length,
  })
}
