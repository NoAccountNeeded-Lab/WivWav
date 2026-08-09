import type { Prisma, PrismaClient } from '../generated/prisma/index.js'
import type { ConversionType, RampType, SaleStatus, WavFeature } from '@wivwav/types'

/**
 * Persistence-side logic of the detail-extract job (#948: relocated verbatim
 * from apps/scraper/src/jobs/detail-extract.ts so apps/api's worker-gateway
 * submit endpoint and the scraper's in-process job share one implementation).
 * The browser/extraction half (parsers, evidence derivation) stays with the
 * scraper/worker; everything here is pure or Prisma-only.
 */

export const DETAIL_EXTRACTION_VERSION = 'detail-v2-evidence'
export const DETAIL_RESOLUTION_ENQUEUE_STAGE = 'detail-resolution-enqueue'

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

export type DetailEvidence = 'value' | 'authoritative_empty' | 'missing'

/**
 * Structural mirror of the scraper's `DetailResult` (parity is asserted in
 * apps/scraper against @wivwav/types' detailResultSchema, whose inferred type
 * this matches). Declared structurally here so this package does not depend
 * on zod for one type.
 */
export interface DetailApplyResult {
  color: string | null
  fuelType: string | null
  engine: string | null
  transmission: string | null
  rampType: RampType
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
    accessibilityClaims: DetailEvidence
  }
}

export interface DetailEnrichment {
  dealerWebsite: string | null
  directVehicleUrl: string | null
}

export function detailObservationReference(rawPage: { id: string; scrapedAt: Date }): string {
  return `${rawPage.id}:${rawPage.scrapedAt.toISOString()}`
}

export function requiresListingResolution(changedFields: string[]): boolean {
  return changedFields.some((field) => ACCESSIBILITY_FIELDS.has(field))
}

function detailResolutionJobId(observationReference: string): string {
  return `detail-resolution:${observationReference}`
}

/**
 * Minimal structural queue surface (deliberately not @wivwav/queue's
 * QueueAdapter — this package must not depend on the queue backend). Both
 * the scraper daemon and the api coordinator pass their real adapter.
 */
export interface ResolutionEnqueueQueue {
  add(data: unknown, options?: { jobId?: string } & Record<string, unknown>): Promise<string>
}

export async function enqueueRequiredListingResolution(
  db: PrismaClient,
  resolutionQueue: ResolutionEnqueueQueue | undefined,
  jobOptions: object,
  listingId: string,
  observationReference: string,
  changedFields: string[],
  parentRunId?: string | null,
): Promise<void> {
  if (!requiresListingResolution(changedFields)) return

  const alreadyEnqueued = await db.listingObservation.findUnique({
    where: {
      stage_reference: {
        stage: DETAIL_RESOLUTION_ENQUEUE_STAGE,
        reference: observationReference,
      },
    },
    select: { id: true },
  })
  if (alreadyEnqueued || !resolutionQueue) return

  await resolutionQueue.add(
    { listingId, observationReference, parentRunId },
    { ...jobOptions, jobId: detailResolutionJobId(observationReference) },
  )
  await db.listingObservation.upsert({
    where: {
      stage_reference: {
        stage: DETAIL_RESOLUTION_ENQUEUE_STAGE,
        reference: observationReference,
      },
    },
    update: {},
    create: {
      listingId,
      stage: DETAIL_RESOLUTION_ENQUEUE_STAGE,
      reference: observationReference,
      extractionVersion: DETAIL_EXTRACTION_VERSION,
      changedFields: [],
      before: {} as Prisma.InputJsonObject,
      after: {} as Prisma.InputJsonObject,
      observedAt: new Date(),
    },
  })
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

export function auditDetailValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value
}

export function buildListingDetailUpdateData(
  detail: DetailApplyResult,
  enrichment: DetailEnrichment,
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
