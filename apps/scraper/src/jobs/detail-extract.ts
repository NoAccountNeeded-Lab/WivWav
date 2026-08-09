import {
  DETAIL_EXTRACTION_VERSION,
  SourceStatus,
  auditDetailValue,
  buildListingDetailUpdateData as buildListingDetailUpdateDataShared,
  changedDetailFields as changedDetailFieldsShared,
  detailObservationReference as detailObservationReferenceShared,
  enqueueRequiredListingResolution as enqueueRequiredListingResolutionShared,
  getDb,
  requiresListingResolution as requiresListingResolutionShared,
  resolveListingStatus as resolveListingStatusShared,
} from '@wivwav/db'
import type { Prisma, StatusUpdate as SharedStatusUpdate } from '@wivwav/db'
import { CRITICAL_JOB_OPTIONS, type JobContext, type QueueAdapter } from '@wivwav/queue'
import type { ConversionType, FieldMapping, RampType, SaleStatus, WavFeature } from '@wivwav/types'
import type { BrowserPage, BrowserService } from '../browser/index.js'
import { evaluateBlvdDetail, parseBlvdDetail } from '../sources/blvd-detail.js'
import type { RawDetail as RawBlvdDetail } from '../sources/blvd-detail.js'
import {
  createRateLimitedFetcher,
  enrichBlvdDealerListing,
  fetchHtml,
} from '../sources/blvd-dealer-enrichment.js'
import { evaluateMwDetail, parseMwDetail } from '../sources/mobilityworks-detail.js'
import { evaluateDeclarativeDetail, parseDeclarativeDetail } from '../sources/declarative-detail.js'
import {
  evaluateSourceListingDates,
  type SourceListingIdentity,
} from '../sources/source-listing-dates.js'
import { recordDetailFieldClaims } from '../resolution/detail-claims.js'
import { withTransientRetry } from '../lib/db-retry.js'
import type { JobRunFinishStats } from '../lib/job-run-repository.js'
import { JobRunStatsError } from '../lib/job-run-tracking.js'
import { report } from './job-progress.js'

/** Bespoke-parser BLVD listing pages are always served from this domain. */
const BLVD_DETAIL_DOMAIN = 'blvd.com'
/** Bespoke-parser MobilityWorks listing pages are always served from this domain. */
const MOBILITYWORKS_DETAIL_DOMAIN = 'mobilityworks.com'

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
// DETAIL_EXTRACTION_VERSION plus the status/diff/enqueue logic below moved to
// @wivwav/db's ingest/detail-apply (#951) so apps/api's worker-gateway submit
// endpoint shares one implementation. Re-exported under their original names
// for this module's existing consumers (tests, fixture-to-facets pipeline).

async function getSourceExecutionBlockReason(sourceId: string): Promise<string | null> {
  const db = getDb()
  const source = await db.source.findUnique({
    where: { id: sourceId },
    select: { status: true, errorMessage: true },
  })
  if (!source) return `Source ${sourceId} no longer exists`
  if (source.status === SourceStatus.disabled) return source.errorMessage ?? 'Source is disabled by operator policy'
  if (source.status === SourceStatus.paused) return source.errorMessage ?? 'Source is paused'
  return null
}

/**
 * Reads `Source.mappings` fresh at the start of every job run — never
 * cached across runs — so a `setMappings` write (an operator edit, or the
 * AI structure-remap loop in scraper-engine.ts) takes effect on the very
 * next detail-extract run with no code change or redeploy (#822).
 *
 * Mirrors `PrismaSourceRepository.getMappings` (infrastructure/prisma-
 * repositories.ts) rather than importing it: this file talks to Prisma
 * directly everywhere else too (see `getSourceExecutionBlockReason` above),
 * so a repository-layer dependency here would be the odd one out, not less
 * duplication overall.
 */
async function getSourceMappings(sourceId: string): Promise<FieldMapping[]> {
  const db = getDb()
  const source = await db.source.findUnique({ where: { id: sourceId }, select: { mappings: true } })
  return (source?.mappings ?? []) as unknown as FieldMapping[]
}

type ListingStatus = 'active' | 'possibly_gone' | 'gone'

export type StatusUpdate = SharedStatusUpdate
export const resolveListingStatus = resolveListingStatusShared

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
    /**
     * Whether this run observed evidence for the #499 entry/ramp claims
     * (conversionType/rampType) specifically. For BLVD/MobilityWorks this
     * always mirrors `description` — their claims are parsed from the same
     * narrative description block. Kept as its own field because the
     * declarative extractor (#822) derives claims from a structured spec
     * field with no narrative description block at all, so the two evidence
     * signals are independent for that source.
     */
    accessibilityClaims: DetailEvidence
  }
}

export type DetailEvidence = 'value' | 'authoritative_empty' | 'missing'

export const detailObservationReference = detailObservationReferenceShared
export const requiresListingResolution = requiresListingResolutionShared

export const changedDetailFields = changedDetailFieldsShared

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

export const buildListingDetailUpdateData = buildListingDetailUpdateDataShared

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
  const description = raw.descriptionText.trim().length > 0 ? 'value' : 'missing'
  return {
    color: Object.hasOwn(raw.specs, 'Color') ? 'value' : 'missing',
    fuelType: 'missing',
    engine: Object.hasOwn(raw.specs, 'Engine') ? 'value' : 'missing',
    transmission: Object.hasOwn(raw.specs, 'Transmission') ? 'value' : 'missing',
    description,
    images: raw.galleryFound
      ? raw.imageUrls.length > 0 ? 'value' : 'authoritative_empty'
      : 'missing',
    // BLVD's entry/ramp claims are parsed from this same description text.
    accessibilityClaims: description,
  }
}

/**
 * Fallback DetailResult for a raw page whose URL matches neither a
 * bespoke-parser domain nor a source with configured `Source.mappings` —
 * nothing to extract, so every field stays 'missing'/unpopulated rather
 * than fabricating a value (#822).
 */
function emptyDetailResult(sourceDates: { sourceListedAt: Date | null; sourceUpdatedAt: Date | null }): DetailResult {
  return {
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    rampType: 'unknown',
    conversionType: 'unknown',
    wavFeatures: [],
    floorLoweringInches: null,
    wheelchairCapacity: null,
    description: null,
    images: [],
    zip: null,
    dealerPhone: null,
    saleStatus: 'active',
    ...sourceDates,
    evidence: {
      color: 'missing',
      fuelType: 'missing',
      engine: 'missing',
      transmission: 'missing',
      description: 'missing',
      images: 'missing',
      accessibilityClaims: 'missing',
    },
  }
}

async function extractDetail(
  page: BrowserPage,
  identity: SourceListingIdentity,
  mappings: FieldMapping[],
): Promise<DetailResult> {
  const sourceDates = await evaluateSourceListingDates(page, identity)
  if (identity.expectedUrl.includes(MOBILITYWORKS_DETAIL_DOMAIN)) {
    const raw = await evaluateMwDetail(page)
    const mw = parseMwDetail(raw)
    const description = raw.descriptionFound
      ? raw.descriptionText.trim().length > 0 ? 'value' : 'authoritative_empty'
      : 'missing'
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
        description,
        images: raw.galleryFound
          ? raw.imageUrls.length > 0 ? 'value' : 'authoritative_empty'
          : 'missing',
        // MobilityWorks' entry/ramp claims are parsed from this same description text.
        accessibilityClaims: description === 'missing' ? 'missing' : 'value',
      },
    }
  }
  if (identity.expectedUrl.includes(BLVD_DETAIL_DOMAIN)) {
    const raw = await evaluateBlvdDetail(page)
    return {
      ...parseBlvdDetail(raw),
      ...sourceDates,
      evidence: blvdEvidence(raw),
    }
  }
  if (mappings.length > 0) {
    const raw = await evaluateDeclarativeDetail(page, mappings)
    return {
      ...parseDeclarativeDetail(raw, mappings),
      ...sourceDates,
    }
  }
  // No bespoke parser for this domain and no Source.mappings configured —
  // nothing this job knows how to extract from the page.
  return emptyDetailResult(sourceDates)
}

export async function runDetailExtractJob(
  sourceId: string,
  context?: JobContext,
  browserService?: BrowserService,
  resolutionQueue?: QueueAdapter,
): Promise<JobRunFinishStats | void> {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('[detail-extract] sourceId must be a non-empty string')
  }
  const db = getDb()

  const initialBlockReason = await getSourceExecutionBlockReason(sourceId)
  if (initialBlockReason !== null) {
    await report(context, `[detail-extract] Skipped source ${sourceId}: ${initialBlockReason}`, {
      stage: 'blocked',
      reason: 'source_disabled',
      current: 0,
      total: 0,
    })
    await db.$disconnect()
    return
  }

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

  // Read once per run (not cached across runs) — see getSourceMappings's docstring.
  const mappings = await getSourceMappings(sourceId)

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
      const midRunBlockReason = await getSourceExecutionBlockReason(sourceId)
      if (midRunBlockReason !== null) {
        await report(context, `[detail-extract] Stopped source ${sourceId}: ${midRunBlockReason}`, {
          stage: 'blocked',
          reason: 'source_disabled_mid_run',
          current: i,
          total: rawPages.length,
        })
        break
      }

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
        }, mappings)

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
            select: { id: true, changedFields: true },
          })
          if (alreadyApplied) {
            await enqueueRequiredListingResolutionShared(
              db,
              resolutionQueue,
              CRITICAL_JOB_OPTIONS,
              listing.id,
              observationReference,
              alreadyApplied.changedFields,
              context?.runId,
            )
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
          const claimsObserved = detail.evidence.accessibilityClaims !== 'missing'
          const changedFields = changedDetailFields(
            listing as unknown as Record<string, unknown>,
            update as Record<string, unknown>,
          )
          const before = Object.fromEntries(
            changedFields.map((field) => [field, auditDetailValue((listing as unknown as Record<string, unknown>)[field])]),
          )
          const after = Object.fromEntries(
            changedFields.map((field) => [field, auditDetailValue((update as Record<string, unknown>)[field])]),
          )

          // Serializable, like PrismaListingRepository.upsert's ingestListing
          // transaction — same pool-contention/transient-close hazard under
          // the scraper's concurrent workers, so it gets the same retry.
          await withTransientRetry(() => db.$transaction(async (tx) => {
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
          }, { isolationLevel: 'Serializable' }))
          // Search-index sync is no longer this job's concern — the
          // single-owner indexer poller (#669) picks up the change (via
          // `updatedAt`, bumped by the transaction above) on its next tick.
          await enqueueRequiredListingResolutionShared(
            db,
            resolutionQueue,
            CRITICAL_JOB_OPTIONS,
            listing.id,
            observationReference,
            changedFields,
            context?.runId,
          )

          // #499: record an independent detail-page claim for whatever
          // accessibility evidence this raw page actually observed, then
          // re-resolve. Gated on claimsObserved — a failed/absent
          // extraction is not a claim of "no evidence" and must not
          // downgrade an existing resolution. Its own transaction, after
          // the main update commits — see detail-claims.ts's docstring.
          if (claimsObserved) {
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
    throw new JobRunStatsError(`[detail-extract] ${reason}`, { succeededCount: success, failedCount: failed })
  }

  return { succeededCount: success, failedCount: failed }
}
