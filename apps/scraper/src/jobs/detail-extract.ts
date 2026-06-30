import { getDb, type Prisma } from '@wivwav/db'
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
const DETAIL_EXTRACTION_VERSION = 'detail-v2-evidence'
const DETAIL_METADATA_FIELDS = new Set([
  'detailScrapedAt',
  'publicationStatus',
  'qualityIssueCodes',
  'qualityCheckedAt',
])

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
 * - pending banner on possibly_gone that is NOT index-absent → restore to active
 * - pending banner on active → no status change (stays visible in search with saleStatus label)
 * - possibly_gone with NO index-absence evidence + no/pending banner → restore to active
 * - possibly_gone with index-absence evidence (missingFromCompleteCount > 0) + no/pending banner
 *   → no status change from detail page; only a new complete source crawl may restore it
 * - active + no banner (stale refresh) → no status change
 *
 * The `missingFromCompleteCount` parameter is the number of consecutive complete
 * source crawls that did not include this listing. A value > 0 means the listing
 * is absent from the source index; a detail-page 200 without a sold/gone banner
 * is then a stale orphan page and must NOT restore the listing to active.
 */
export function resolveListingStatus(
  currentStatus: ListingStatus,
  saleStatus: SaleStatus,
  existingSoldAt: Date | null,
  now: Date,
  missingFromCompleteCount = 0,
): StatusUpdate {
  if ((saleStatus === 'sold' || saleStatus === 'gone') && currentStatus !== 'gone') {
    return {
      status: 'gone',
      goneAt: now,
      ...(saleStatus === 'sold' && existingSoldAt == null ? { soldAt: now } : {}),
    }
  }
  if (currentStatus === 'possibly_gone' && saleStatus !== 'sold') {
    // When the listing is missing from the source index (has been absent from ≥1
    // complete crawl), a 200 detail response without a sold/gone banner is not
    // sufficient evidence to restore active status. The listing might be an orphan
    // detail page that remains reachable after the dealer removes it from inventory.
    // Only a new complete source crawl that includes the listing can restore it.
    if (missingFromCompleteCount > 0) {
      return {}
    }
    // Pending banner means the listing is still live (just under contract); restore it.
    // No banner also means it's still live when there is no index-absence evidence.
    return { status: 'active', goneAt: null }
  }
  return {}
}

export type DetailResult = {
  color: string | null
  /**
   * Explicit fuel type from source (e.g. "Gasoline", "Hybrid").
   * null for BLVD listings, which expose an engine description instead.
   */
  fuelType: string | null
  /**
   * Raw engine description (e.g. "3.5L V6 DOHC"). Present for BLVD listings;
   * null for sources that expose an explicit fuelType key instead.
   * Never stored as fuelType — stored separately so canonicalize.ts can
   * derive fuel type without exposing engine descriptions as fuel type.
   */
  engine: string | null
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
  evidence: {
    specs: DetailEvidence
    description: DetailEvidence
    images: DetailEvidence
  }
}

export type DetailEvidence = 'value' | 'authoritative_empty' | 'missing'

function sameDetailValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((value, index) => value === right[index])
  }
  return left === right
}

export function changedDetailFields(
  existing: Record<string, unknown>,
  update: Record<string, unknown>,
): string[] {
  return Object.keys(update).filter(
    (field) => !DETAIL_METADATA_FIELDS.has(field) && !sameDetailValue(existing[field], update[field]),
  )
}

function auditValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value
}

export function buildListingDetailUpdateData(
  detail: DetailResult,
  enrichment: BlvdDealerEnrichment,
  statusUpdate: StatusUpdate,
  now: Date,
) {
  const specsObserved = detail.evidence.specs !== 'missing'
  const descriptionObserved = detail.evidence.description !== 'missing'
  const imagesObserved = detail.evidence.images !== 'missing'
  return {
    ...(specsObserved ? {
      color: detail.color,
      fuelType: detail.fuelType,
      transmission: detail.transmission,
    } : {}),
    ...(specsObserved && detail.engine !== null ? { engine: detail.engine } : {}),
    ...(descriptionObserved ? {
      rampType: detail.rampType,
      wavFeatures: detail.wavFeatures,
      floorLoweringInches: detail.floorLoweringInches,
      wheelchairCapacity: detail.wheelchairCapacity,
      description: detail.evidence.description === 'authoritative_empty' ? null : detail.description,
    } : {}),
    ...(imagesObserved ? { images: detail.images } : {}),
    ...(detail.zip && { zip: detail.zip }),
    ...(detail.dealerPhone && { dealerPhone: detail.dealerPhone }),
    ...(enrichment.dealerWebsite && { dealerWebsite: enrichment.dealerWebsite }),
    ...(enrichment.directVehicleUrl && { buyerUrl: enrichment.directVehicleUrl }),
    saleStatus: detail.saleStatus,
    ...statusUpdate,
    detailScrapedAt: now,
    // Detail data is part of the publication decision. Invalidate any previous
    // decision until the validator evaluates this new observation.
    publicationStatus: 'pending' as const,
    qualityIssueCodes: [],
    qualityCheckedAt: null,
  }
}

async function extractDetail(page: BrowserPage, url: string): Promise<DetailResult> {
  if (url.includes('mobilityworks.com')) {
    const raw = await evaluateMwDetail(page)
    const mw = parseMwDetail(raw)
    // MobilityWorks exposes an explicit "Fuel Type" spec key; no engine description field.
    return {
      ...mw,
      engine: null,
      evidence: {
        specs: Object.keys(raw.specs).length > 0 ? 'value' : 'missing',
        description: raw.descriptionFound
          ? raw.descriptionText.trim().length > 0 ? 'value' : 'authoritative_empty'
          : 'missing',
        images: raw.galleryFound
          ? raw.imageUrls.length > 0 ? 'value' : 'authoritative_empty'
          : 'missing',
      },
    }
  }
  const raw = await evaluateBlvdDetail(page)
  return {
    ...parseBlvdDetail(raw),
    evidence: {
      specs: Object.keys(raw.specs).length > 0 ? 'value' : 'missing',
      description: raw.descriptionFound === true
        ? raw.descriptionText.trim().length > 0 ? 'value' : 'authoritative_empty'
        : raw.descriptionText.trim().length > 0 ? 'value' : 'missing',
      images: raw.galleryFound === true
        ? raw.imageUrls.length > 0 ? 'value' : 'authoritative_empty'
        : raw.imageUrls.length > 0 ? 'value' : 'missing',
    },
  }
}

export async function runDetailExtractJob(
  sourceId: string,
  context?: JobContext,
  browserService?: BrowserService,
): Promise<void> {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('[detail-extract] sourceId must be a non-empty string')
  }
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
          select: {
            id: true,
            status: true,
            soldAt: true,
            vin: true,
            missingFromCompleteCount: true,
            color: true,
            fuelType: true,
            engine: true,
            transmission: true,
            rampType: true,
            wavFeatures: true,
            floorLoweringInches: true,
            wheelchairCapacity: true,
            description: true,
            images: true,
            zip: true,
            dealerPhone: true,
            dealerWebsite: true,
            buyerUrl: true,
            saleStatus: true,
            goneAt: true,
            publicationStatus: true,
            qualityIssueCodes: true,
            qualityCheckedAt: true,
            detailScrapedAt: true,
            updatedAt: true,
          },
        })

        if (listing) {
          const alreadyApplied = await db.listingObservation.findUnique({
            where: {
              stage_reference: {
                stage: 'detail',
                reference: rawPage.id,
              },
            },
            select: { id: true, changedFields: true, searchSyncedAt: true, listingId: true },
          })
          if (alreadyApplied) {
            if (alreadyApplied.changedFields.length > 0 && alreadyApplied.searchSyncedAt === null) {
              await syncListings([alreadyApplied.listingId], db, getMeiliClient())
              await db.listingObservation.update({
                where: { id: alreadyApplied.id },
                data: { searchSyncedAt: new Date() },
              })
            }
            await db.rawPage.update({
              where: { id: rawPage.id },
              data: { processedAt: new Date() },
            })
            success++
            continue
          }

          const now = new Date()
          const statusUpdate = resolveListingStatus(
            listing.status as ListingStatus,
            detail.saleStatus,
            listing.soldAt,
            now,
            listing.missingFromCompleteCount,
          )
          const enrichment = await enrichBlvdDealerListing({
            sourceUrl: rawPage.url,
            vin: listing.vin,
            fetchPage: fetchDealerPage,
            log: (message) => report(context, message),
          })

          const update = buildListingDetailUpdateData(detail, enrichment, statusUpdate, now)
          const changedFields = changedDetailFields(
            listing as unknown as Record<string, unknown>,
            update as Record<string, unknown>,
          )
          const before = Object.fromEntries(
            changedFields.map((field) => [field, auditValue((listing as unknown as Record<string, unknown>)[field])]),
          )
          const after = Object.fromEntries(
            changedFields.map((field) => [field, auditValue((update as Record<string, unknown>)[field])]),
          )

          await db.$transaction(async (tx) => {
            await tx.listing.update({
              where: { id: listing.id, updatedAt: listing.updatedAt },
              data: changedFields.length > 0 ? update : { detailScrapedAt: now },
            })
            await tx.listingObservation.create({
              data: {
                listingId: listing.id,
                stage: 'detail',
                reference: rawPage.id,
                extractionVersion: DETAIL_EXTRACTION_VERSION,
                changedFields,
                before: before as Prisma.InputJsonObject,
                after: after as Prisma.InputJsonObject,
                observedAt: now,
                ...(changedFields.length === 0 ? { searchSyncedAt: now } : {}),
              },
            })
          }, { isolationLevel: 'Serializable' })
          if (changedFields.length > 0) {
            await syncListings([listing.id], db, getMeiliClient())
            await db.listingObservation.update({
              where: {
                stage_reference: {
                  stage: 'detail',
                  reference: rawPage.id,
                },
              },
              data: { searchSyncedAt: new Date() },
            })
          }
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
