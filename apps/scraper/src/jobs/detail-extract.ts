import { getDb, type Prisma } from '@wivwav/db'
import { CRITICAL_JOB_OPTIONS, type JobContext, type QueueAdapter } from '@wivwav/queue'
import type { ConversionType, RampType, SaleStatus, WavFeature } from '@wivwav/types'
import type { BrowserPage, BrowserService } from '../browser/index.js'
import { evaluateBlvdDetail, parseBlvdDetail } from '../sources/blvd-detail.js'
import type { RawDetail as RawBlvdDetail } from '../sources/blvd-detail.js'
import {
  createRateLimitedFetcher,
  enrichBlvdDealerListing,
  fetchHtml,
  type BlvdDealerEnrichment,
} from '../sources/blvd-dealer-enrichment.js'
import { evaluateMwDetail, parseMwDetail } from '../sources/mobilityworks-detail.js'
import {
  evaluateSourceListingDates,
  type SourceListingIdentity,
} from '../sources/source-listing-dates.js'
import { recordDetailFieldClaims } from '../resolution/detail-claims.js'
import { report } from './job-progress.js'

const BATCH_SIZE = 100
/**
 * Bounds per-page error text logged/reported for a failed extraction.
 * A raw Prisma validation error embeds its full call arguments — including
 * the update payload's `description` field, which can carry unredacted
 * private-seller copy — in `.message`. Collapsing whitespace and truncating
 * keeps the failure diagnosable (source + error class) without dumping that
 * payload into logs (#637).
 */
const ERROR_LOG_MAX_LENGTH = 300
const DETAIL_EXTRACTION_VERSION = 'detail-v2-evidence'
const DETAIL_METADATA_FIELDS = new Set([
  'detailScrapedAt',
  'publicationStatus',
  'qualityIssueCodes',
  'qualityCheckedAt',
])
const ACCESSIBILITY_FIELDS = new Set([
  'conversionType',
  'conversionManufacturer',
  'conversionStatus',
  'rampType',
  'wavFeatures',
  'floorLoweringInches',
  'wheelchairCapacity',
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
  /**
   * Entry-direction claim parsed from the vehicle-specific detail
   * description text (#499). Independent of any card/category-derived
   * value — recordDetailFieldClaims below feeds it to the resolver rather
   * than writing it straight to the Listing row.
   */
  conversionType: ConversionType
  wavFeatures: WavFeature[]
  floorLoweringInches: number | null
  wheelchairCapacity: number | null
  description: string | null
  images: string[]
  zip: string | null
  dealerPhone: string | null
  saleStatus: SaleStatus
  sourceListedAt: Date | null
  sourceUpdatedAt: Date | null
  evidence: {
    color: DetailEvidence
    fuelType: DetailEvidence
    engine: DetailEvidence
    transmission: DetailEvidence
    description: DetailEvidence
    images: DetailEvidence
  }
}

export type DetailEvidence = 'value' | 'authoritative_empty' | 'missing'

export function detailObservationReference(rawPage: { id: string; scrapedAt: Date }): string {
  return `${rawPage.id}:${rawPage.scrapedAt.toISOString()}`
}

export function requiresListingResolution(changedFields: string[]): boolean {
  return changedFields.some((field) => ACCESSIBILITY_FIELDS.has(field))
}

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

/**
 * Formats a caught error for logging: message-only (no stack, no thrown
 * non-Error payload dump), whitespace-collapsed, and length-bounded. See
 * `ERROR_LOG_MAX_LENGTH` for why this matters for private-seller data.
 *
 * Bounding length alone is not enough: a Prisma validation error's payload
 * dump starts immediately after a short "Invalid `db.x.y()` invocation:"
 * header, so a listing's `description` can appear well inside any reasonable
 * length cap. Cut at the first `{` — where that argument dump begins — and
 * keep only the header/reason before it.
 */
export function summarizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const headerOnly = raw.split('{')[0] ?? raw
  const collapsed = headerOnly.replace(/\s+/g, ' ').trim()
  const bounded = collapsed.length > ERROR_LOG_MAX_LENGTH
    ? `${collapsed.slice(0, ERROR_LOG_MAX_LENGTH)}…`
    : collapsed
  return bounded.length > 0 ? bounded : 'error (no message)'
}

export function buildListingDetailUpdateData(
  detail: DetailResult,
  enrichment: BlvdDealerEnrichment,
  statusUpdate: StatusUpdate,
  now: Date,
) {
  const descriptionObserved = detail.evidence.description !== 'missing'
  const imagesObserved = detail.evidence.images !== 'missing'
  return {
    ...(detail.evidence.color !== 'missing' ? { color: detail.color } : {}),
    ...(detail.evidence.fuelType !== 'missing' ? { fuelType: detail.fuelType } : {}),
    ...(detail.evidence.engine !== 'missing' ? { engine: detail.engine } : {}),
    ...(detail.evidence.transmission !== 'missing' ? { transmission: detail.transmission } : {}),
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
    ...(detail.sourceListedAt !== null ? { sourceListedAt: detail.sourceListedAt } : {}),
    ...(detail.sourceUpdatedAt !== null ? { sourceUpdatedAt: detail.sourceUpdatedAt } : {}),
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

/**
 * Builds the BLVD-branch evidence record from raw extraction output.
 *
 * `images` uses `raw.galleryFound` — set by `evaluateBlvdDetail` when either
 * the default template's "_large.jpg" anchors or a reseller template's
 * bounded gallery/carousel container was located — to distinguish "gallery
 * container not found" ('missing', preserves the prior DB value) from
 * "verified empty gallery" ('authoritative_empty', clears it). Mirrors the
 * MobilityWorks branch below (refs #513/#576, fixes #632).
 */
export function blvdEvidence(raw: RawBlvdDetail): DetailResult['evidence'] {
  return {
    color: Object.hasOwn(raw.specs, 'Color') ? 'value' : 'missing',
    fuelType: 'missing',
    engine: Object.hasOwn(raw.specs, 'Engine') ? 'value' : 'missing',
    transmission: Object.hasOwn(raw.specs, 'Transmission') ? 'value' : 'missing',
    description: raw.descriptionText.trim().length > 0 ? 'value' : 'missing',
    images: raw.galleryFound
      ? raw.imageUrls.length > 0 ? 'value' : 'authoritative_empty'
      : 'missing',
  }
}

async function extractDetail(
  page: BrowserPage,
  identity: SourceListingIdentity,
): Promise<DetailResult> {
  const sourceDates = await evaluateSourceListingDates(page, identity)
  if (identity.expectedUrl.includes('mobilityworks.com')) {
    const raw = await evaluateMwDetail(page)
    const mw = parseMwDetail(raw)
    // MobilityWorks exposes an explicit "Fuel Type" spec key; no engine description field.
    return {
      ...mw,
      engine: null,
      ...sourceDates,
      evidence: {
        color: Object.hasOwn(raw.specs, 'Exterior Color') || Object.hasOwn(raw.specs, 'Color') ? 'value' : 'missing',
        fuelType: Object.hasOwn(raw.specs, 'Fuel Type') ? 'value' : 'missing',
        engine: 'missing',
        transmission: Object.hasOwn(raw.specs, 'Transmission') ? 'value' : 'missing',
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
    ...sourceDates,
    evidence: blvdEvidence(raw),
  }
}

export async function runDetailExtractJob(
  sourceId: string,
  context?: JobContext,
  browserService?: BrowserService,
  resolutionQueue?: QueueAdapter,
): Promise<void> {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('[detail-extract] sourceId must be a non-empty string')
  }
  const db = getDb()

  const rawPages = await db.rawPage.findMany({
    where: { sourceId, processedAt: null },
    select: { id: true, url: true, html: true, scrapedAt: true },
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
      const observationReference = detailObservationReference(rawPage)
      const page = await browser.newPage()

      try {
        const listing = await db.listing.findFirst({
          where: { sourceUrl: rawPage.url },
          select: {
            id: true,
            sourceRecordKey: true,
            externalId: true,
            stockNumber: true,
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
            sourceListedAt: true,
            sourceUpdatedAt: true,
            goneAt: true,
            publicationStatus: true,
            qualityIssueCodes: true,
            qualityCheckedAt: true,
            detailScrapedAt: true,
            updatedAt: true,
          },
        })

        await page.setContent(rawPage.html, { waitUntil: 'domcontentloaded' })
        const sourceIdentifiers = [listing?.sourceRecordKey, listing?.externalId, listing?.stockNumber]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        const detail = await extractDetail(page, {
          expectedUrl: rawPage.url,
          expectedVin: listing?.vin ?? null,
          expectedSourceIdentifiers: sourceIdentifiers,
        })

        if (listing) {
          // Retry idempotency: if this observation reference was already recorded
          // (a prior attempt committed the listing update but the job was retried
          // before marking rawPage.processedAt), skip straight to that bookkeeping
          // rather than re-applying the detail update. Search-index sync is not
          // this job's concern either way — the single-owner indexer poller (#669)
          // picks up any touched listing (via `updatedAt`) on its next tick.
          const alreadyApplied = await db.listingObservation.findUnique({
            where: {
              stage_reference: {
                stage: 'detail',
                reference: observationReference,
              },
            },
            select: { id: true },
          })
          if (alreadyApplied) {
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
          const descriptionObserved = detail.evidence.description !== 'missing'
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
                reference: observationReference,
                extractionVersion: DETAIL_EXTRACTION_VERSION,
                changedFields,
                before: before as Prisma.InputJsonObject,
                after: after as Prisma.InputJsonObject,
                observedAt: now,
              },
            })
          }, { isolationLevel: 'Serializable' })
          // Search-index sync is no longer this job's concern — the
          // single-owner indexer poller (#669) picks up the change (via
          // `updatedAt`, bumped by the transaction above) on its next tick.
          if (requiresListingResolution(changedFields)) {
            await resolutionQueue?.add(
              { listingId: listing.id, observationReference },
              CRITICAL_JOB_OPTIONS,
            )
          }

          // #499: record an independent detail-page claim for whatever
          // accessibility evidence this raw page actually observed, then
          // re-resolve. Gated on descriptionObserved — a failed/absent
          // extraction is not a claim of "no evidence" and must not
          // downgrade an existing resolution. Its own transaction, after
          // the main update commits — see detail-claims.ts's docstring.
          if (descriptionObserved) {
            await recordDetailFieldClaims(
              db,
              listing.id,
              { conversionType: detail.conversionType, rampType: detail.rampType },
              rawPage.url,
              DETAIL_EXTRACTION_VERSION,
            )
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
        // The raw page is deliberately left with `processedAt: null` here —
        // it stays eligible for the next scheduled run to retry. Whatever
        // was already committed for other pages in this batch is unaffected.
        await report(context, `[detail-extract] Failed ${rawPage.url}: ${summarizeError(err)}`)
        failed++
      } finally {
        await page.close()
      }

      await report(context, `[detail-extract] Processed ${i + 1}/${rawPages.length} raw page(s)`, {
        stage: 'extracting',
        current: i + 1,
        total: rawPages.length,
        success,
        failed,
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
    success,
    failed,
  })

  if (failed > 0) {
    // Pages that succeeded are already committed (rawPage.processedAt set,
    // listing + observation written); failed pages remain retryable
    // (processedAt: null) for the next scheduled run. Throwing here — after
    // that work is safely persisted — is what makes BullMQ record the job
    // itself as failed instead of silently completing, so queue/API/Ops
    // health (which reads `failedReason`) surfaces the partial outage (#637).
    const reason = `${failed} of ${rawPages.length} raw page(s) failed extraction for source ${sourceId} (${success} succeeded)`
    context?.logger?.error(
      { event: 'detail-extract.partial-failure', sourceId, success, failed, total: rawPages.length },
      `[detail-extract] ${reason}`,
    )
    throw new Error(`[detail-extract] ${reason}`)
  }
}
