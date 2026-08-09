import { z } from 'zod'
import { WAV_FEATURES, type WavFeature } from './listing.js'

/**
 * HTTP request/response contracts for the coordinator's `/internal/scraper`
 * gateway (#948): the phase-1 job types (source-scrape, detail-crawl,
 * detail-extract) run on remote workers that hold no database access and
 * submit every read/write through these shapes.
 *
 * The scraper-run/source/listing groups mirror the port interfaces in
 * `apps/scraper/src/engine/repositories.ts` (`ScraperRunRepository`,
 * `SourceRepository`, `ListingRepository`); parity is asserted by
 * compile-time tests in `apps/scraper`. The detail-crawl/detail-extract
 * groups cover data access that has no port today.
 *
 * Date-bearing fields cross the wire as ISO strings; every date field uses
 * `z.coerce.date()` so both sides parse back to `Date` — never assume a
 * `Date` object survives JSON.
 */

// --- shared vocabulary (kept in parity with ./listing.js types by tests) ---

export const conversionTypeSchema = z.enum(['rear_entry', 'side_entry', 'unknown'])
export const rampTypeSchema = z.enum(['in_floor', 'fold_out', 'fold_in', 'none', 'unknown'])
export const conversionStatusSchema = z.enum(['proposed', 'complete', 'unknown'])
export const listingConditionSchema = z.enum(['new', 'used', 'certified_pre_owned'])
export const listingSellerTypeSchema = z.enum(['dealer', 'private'])
export const saleStatusSchema = z.enum(['active', 'pending', 'sold', 'gone'])
export const fieldResolutionStateSchema = z.enum(['verified', 'source_reported', 'conflicting', 'unknown'])

/** Derived from WAV_FEATURES so the vocabulary cannot drift from ./listing.js. */
export const wavFeatureSchema = z.enum(
  Object.keys(WAV_FEATURES) as [WavFeature, ...WavFeature[]],
)

/** Mirrors Prisma's `ListingStatus` enum (lifecycle, distinct from SaleStatus). */
export const listingStatusSchema = z.enum(['active', 'possibly_gone', 'gone'])
export type ListingStatus = z.infer<typeof listingStatusSchema>

/** Mirrors Prisma's `PublicationStatus` enum. */
export const publicationStatusSchema = z.enum(['pending', 'eligible', 'quarantined'])

export const wavFeaturesSchema = z.object({
  conversionType: conversionTypeSchema,
  conversionManufacturer: z.string().nullable(),
  floorLoweringInches: z.number().nullable(),
  rampType: rampTypeSchema,
  conversionStatus: conversionStatusSchema,
  wavFeatures: z.array(wavFeatureSchema),
  wheelchairCapacity: z.number().nullable(),
})

export const wavFieldResolutionSchema = z.object({
  conversionType: fieldResolutionStateSchema,
  rampType: fieldResolutionStateSchema,
})

export const listingLocationSchema = z.object({
  zip: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
})

export const listingDealerSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
})

export const fieldMappingSchema = z.object({
  targetField: z.string(),
  selector: z.string(),
  attribute: z.string().nullable(),
  transform: z.string().nullable(),
})

// --- scraper runs (mirrors ScraperRunRepository) ---

export const scraperRunStartRequestSchema = z.object({
  sourceId: z.string().min(1),
})
export type ScraperRunStartRequest = z.infer<typeof scraperRunStartRequestSchema>

export const scraperRunStartResponseSchema = z.object({
  id: z.string().min(1),
})
export type ScraperRunStartResponse = z.infer<typeof scraperRunStartResponseSchema>

export const scraperRunCompleteRequestSchema = z.object({
  runId: z.string().min(1),
  listingsFound: z.number().int().nonnegative(),
  changes: z
    .object({
      listingsNew: z.number().int().nonnegative(),
      listingsUpdated: z.number().int().nonnegative(),
    })
    .optional(),
})
export type ScraperRunCompleteRequest = z.infer<typeof scraperRunCompleteRequestSchema>

export const scraperRunFailRequestSchema = z.object({
  runId: z.string().min(1),
  errorMessage: z.string(),
})
export type ScraperRunFailRequest = z.infer<typeof scraperRunFailRequestSchema>

// --- sources (mirrors SourceRepository) ---

export const sourceExecutionStateSchema = z.object({
  status: z.enum(['active', 'disabled', 'paused', 'error', 'needs_remapping']),
  errorMessage: z.string().nullable(),
})

/** `state` is null when the source no longer exists. */
export const sourceExecutionStateResponseSchema = z.object({
  state: sourceExecutionStateSchema.nullable(),
})
export type SourceExecutionStateResponse = z.infer<typeof sourceExecutionStateResponseSchema>

export const sourceMarkNeedsRemappingRequestSchema = z.object({
  sourceId: z.string().min(1),
  errorMessage: z.string().optional(),
})
export type SourceMarkNeedsRemappingRequest = z.infer<typeof sourceMarkNeedsRemappingRequestSchema>

export const sourceMarkActiveRequestSchema = z.object({
  sourceId: z.string().min(1),
  listingCount: z.number().int().nonnegative(),
  fingerprintHash: z.string(),
  page1Hash: z.string().optional(),
  isCompleteCrawl: z.boolean(),
})
export type SourceMarkActiveRequest = z.infer<typeof sourceMarkActiveRequestSchema>

export const sourceMarkCheckedRequestSchema = z.object({
  sourceId: z.string().min(1),
})
export type SourceMarkCheckedRequest = z.infer<typeof sourceMarkCheckedRequestSchema>

export const sourceMarkErrorRequestSchema = z.object({
  sourceId: z.string().min(1),
  errorMessage: z.string(),
})
export type SourceMarkErrorRequest = z.infer<typeof sourceMarkErrorRequestSchema>

export const sourceMarkPausedRequestSchema = z.object({
  sourceId: z.string().min(1),
  reason: z.string(),
})
export type SourceMarkPausedRequest = z.infer<typeof sourceMarkPausedRequestSchema>

export const sourceMappingsResponseSchema = z.object({
  mappings: z.array(fieldMappingSchema),
})
export type SourceMappingsResponse = z.infer<typeof sourceMappingsResponseSchema>

export const sourceSetMappingsRequestSchema = z.object({
  sourceId: z.string().min(1),
  mappings: z.array(fieldMappingSchema),
})
export type SourceSetMappingsRequest = z.infer<typeof sourceSetMappingsRequestSchema>

export const sourceLastFullCrawlAtResponseSchema = z.object({
  lastFullCrawlAt: z.coerce.date().nullable(),
})
export type SourceLastFullCrawlAtResponse = z.infer<typeof sourceLastFullCrawlAtResponseSchema>

export const sourceDriftBaselineSchema = z.object({
  baselineErrorRate: z.number().min(0).max(1),
  baselineMissingRate: z.number().min(0).max(1),
})

/** `baseline` is null until a first run has completed for the source. */
export const sourceDriftBaselineResponseSchema = z.object({
  baseline: sourceDriftBaselineSchema.nullable(),
})
export type SourceDriftBaselineResponse = z.infer<typeof sourceDriftBaselineResponseSchema>

export const sourceSetDriftBaselineRequestSchema = z.object({
  sourceId: z.string().min(1),
  baseline: sourceDriftBaselineSchema,
})
export type SourceSetDriftBaselineRequest = z.infer<typeof sourceSetDriftBaselineRequestSchema>

// --- listing ingest (mirrors ListingRepository) ---

/**
 * Mirrors `ListingUpsertData` (apps/scraper/src/engine/repositories.ts);
 * bidirectional assignability is asserted at compile time there.
 */
export const listingUpsertRequestSchema = z.object({
  sourceId: z.string().min(1),
  sourceUrl: z.string().min(1),
  buyerUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  stockNumber: z.string().nullable(),
  sourceRecordKey: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  trim: z.string().nullable(),
  vin: z.string().nullable(),
  condition: listingConditionSchema,
  sellerType: listingSellerTypeSchema,
  priceCents: z.number().nullable(),
  mileage: z.number().nullable(),
  color: z.string().nullable(),
  fuelType: z.string().nullable(),
  transmission: z.string().nullable(),
  wav: wavFeaturesSchema,
  fieldResolution: wavFieldResolutionSchema.optional(),
  location: listingLocationSchema,
  dealer: listingDealerSchema,
  images: z.array(z.string()),
  description: z.string().nullable(),
  qualityIssueCodes: z.array(z.string()).optional(),
  saleStatus: saleStatusSchema,
  soldAt: z.coerce.date().nullable(),
  listedAt: z.coerce.date(),
  sourceListedAt: z.coerce.date().nullable().optional(),
  sourceUpdatedAt: z.coerce.date().nullable().optional(),
  publicationStatus: publicationStatusSchema.optional(),
  qualityCheckedAt: z.coerce.date().nullable().optional(),
  runId: z.string().nullable().optional(),
})
export type ListingUpsertRequest = z.infer<typeof listingUpsertRequestSchema>

/** Mirrors `ListingUpsertResult` (apps/scraper/src/engine/repositories.ts). */
export const listingUpsertResponseSchema = z.object({
  listingId: z.string().min(1),
  outcome: z.enum(['created', 'updated', 'unchanged']),
  changedFields: z.array(z.string()),
})
export type ListingUpsertResponse = z.infer<typeof listingUpsertResponseSchema>

/**
 * Mirrors `ListingRepository.markGone`. `scraperRunId` keys the server-side
 * idempotency marker: `missingFromCompleteCount` increments at most once per
 * (sourceId, scraperRunId), so an HTTP retry cannot double-count (#948).
 * The old `onGone` search-index callback has no wire equivalent — the
 * single-owner indexer poller picks up status changes via `updatedAt`.
 */
export const listingMarkGoneRequestSchema = z.object({
  sourceId: z.string().min(1),
  scraperRunId: z.string().min(1),
  activeSourceRecordKeys: z.array(z.string()),
  isCompleteCrawl: z.boolean(),
})
export type ListingMarkGoneRequest = z.infer<typeof listingMarkGoneRequestSchema>

export const listingMarkGoneResponseSchema = z.object({
  goneCount: z.number().int().nonnegative(),
})
export type ListingMarkGoneResponse = z.infer<typeof listingMarkGoneResponseSchema>

// --- detail-crawl (no port today; mirrors apps/scraper/src/jobs/detail-crawl.ts) ---

export const detailCrawlPendingListingsRequestSchema = z.object({
  sourceId: z.string().min(1),
  limit: z.number().int().positive().optional(),
})
export type DetailCrawlPendingListingsRequest = z.infer<typeof detailCrawlPendingListingsRequestSchema>

export const detailCrawlPendingListingsResponseSchema = z.object({
  listings: z.array(
    z.object({
      sourceUrl: z.string(),
      status: listingStatusSchema,
    }),
  ),
})
export type DetailCrawlPendingListingsResponse = z.infer<typeof detailCrawlPendingListingsResponseSchema>

/** Upsert resets `processedAt` so detail-extract re-processes on re-crawl. */
export const rawPageUpsertRequestSchema = z.object({
  sourceId: z.string().min(1),
  url: z.string().min(1),
  html: z.string(),
})
export type RawPageUpsertRequest = z.infer<typeof rawPageUpsertRequestSchema>

export const rawPageUpsertResponseSchema = z.object({
  rawPageId: z.string().min(1),
})
export type RawPageUpsertResponse = z.infer<typeof rawPageUpsertResponseSchema>

/**
 * Authoritative gone signal from detail-crawl (HTTP 404 or off-domain
 * redirect): marks every non-gone listing at this URL as gone immediately,
 * without waiting for the extract stage.
 */
export const listingMarkGoneByUrlRequestSchema = z.object({
  sourceUrl: z.string().min(1),
})
export type ListingMarkGoneByUrlRequest = z.infer<typeof listingMarkGoneByUrlRequestSchema>

export const listingMarkGoneByUrlResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
})
export type ListingMarkGoneByUrlResponse = z.infer<typeof listingMarkGoneByUrlResponseSchema>

// --- detail-extract (no port today; mirrors apps/scraper/src/jobs/detail-extract.ts) ---

export const detailExtractPendingRawPagesRequestSchema = z.object({
  sourceId: z.string().min(1),
  limit: z.number().int().positive().optional(),
})
export type DetailExtractPendingRawPagesRequest = z.infer<typeof detailExtractPendingRawPagesRequestSchema>

export const rawPageSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  html: z.string(),
  scrapedAt: z.coerce.date(),
})
export type RawPage = z.infer<typeof rawPageSchema>

export const detailExtractPendingRawPagesResponseSchema = z.object({
  rawPages: z.array(rawPageSchema),
})
export type DetailExtractPendingRawPagesResponse = z.infer<typeof detailExtractPendingRawPagesResponseSchema>

export const listingBySourceUrlRequestSchema = z.object({
  sourceUrl: z.string().min(1),
})
export type ListingBySourceUrlRequest = z.infer<typeof listingBySourceUrlRequestSchema>

/**
 * The listing fields detail-extract reads before extraction (identity for
 * the parser: vin + source identifiers) and that the coordinator needs to
 * apply the result. Mirrors the `db.listing.findFirst` select in
 * apps/scraper/src/jobs/detail-extract.ts.
 */
export const listingDetailStateSchema = z.object({
  id: z.string().min(1),
  sourceRecordKey: z.string(),
  externalId: z.string().nullable(),
  stockNumber: z.string().nullable(),
  status: listingStatusSchema,
  soldAt: z.coerce.date().nullable(),
  vin: z.string().nullable(),
  missingFromCompleteCount: z.number().int().nonnegative(),
})
export type ListingDetailState = z.infer<typeof listingDetailStateSchema>

/** `listing` is null when no listing exists for the raw page's URL. */
export const listingBySourceUrlResponseSchema = z.object({
  listing: listingDetailStateSchema.nullable(),
})
export type ListingBySourceUrlResponse = z.infer<typeof listingBySourceUrlResponseSchema>

export const detailEvidenceSchema = z.enum(['value', 'authoritative_empty', 'missing'])

/**
 * Mirrors `DetailResult` (apps/scraper/src/jobs/detail-extract.ts); parity is
 * asserted at compile time there. The worker extracts this from the raw page;
 * the coordinator's submit endpoint derives the status transition, the
 * changed-field diff, and the observation row server-side.
 */
export const detailResultSchema = z.object({
  color: z.string().nullable(),
  fuelType: z.string().nullable(),
  engine: z.string().nullable(),
  transmission: z.string().nullable(),
  rampType: rampTypeSchema,
  conversionType: conversionTypeSchema,
  wavFeatures: z.array(wavFeatureSchema),
  floorLoweringInches: z.number().nullable(),
  wheelchairCapacity: z.number().nullable(),
  description: z.string().nullable(),
  images: z.array(z.string()),
  zip: z.string().nullable(),
  dealerPhone: z.string().nullable(),
  saleStatus: saleStatusSchema,
  sourceListedAt: z.coerce.date().nullable(),
  sourceUpdatedAt: z.coerce.date().nullable(),
  evidence: z.object({
    color: detailEvidenceSchema,
    fuelType: detailEvidenceSchema,
    engine: detailEvidenceSchema,
    transmission: detailEvidenceSchema,
    description: detailEvidenceSchema,
    images: detailEvidenceSchema,
    accessibilityClaims: detailEvidenceSchema,
  }),
})

/** Mirrors `BlvdDealerEnrichment` (apps/scraper/src/sources/blvd-dealer-enrichment.ts). */
export const blvdDealerEnrichmentSchema = z.object({
  dealerWebsite: z.string().nullable(),
  directVehicleUrl: z.string().nullable(),
})

/**
 * Final submission for one raw page. Idempotent: the coordinator recomputes
 * the observation reference from the raw page's id + scrapedAt, and a repeat
 * submission for an already-recorded reference is absorbed as
 * `already_applied` (no new listing update or observation row).
 */
export const detailExtractSubmitRequestSchema = z.object({
  sourceId: z.string().min(1),
  rawPageId: z.string().min(1),
  /** Null when no listing matched the raw page's URL at read time. */
  listingId: z.string().min(1).nullable(),
  detail: detailResultSchema,
  enrichment: blvdDealerEnrichmentSchema,
  /** #933 lineage: the dispatching job run's id, when run tracking is wired. */
  runId: z.string().nullable().optional(),
})
export type DetailExtractSubmitRequest = z.infer<typeof detailExtractSubmitRequestSchema>

export const detailExtractSubmitResponseSchema = z.object({
  outcome: z.enum(['applied', 'already_applied', 'listing_not_found']),
  changedFields: z.array(z.string()),
})
export type DetailExtractSubmitResponse = z.infer<typeof detailExtractSubmitResponseSchema>

/**
 * Marks a raw page processed without a listing update (failure bookkeeping
 * is the inverse: a page the worker could not extract is simply never marked,
 * staying eligible for the next run).
 */
export const rawPageMarkProcessedRequestSchema = z.object({
  rawPageId: z.string().min(1),
})
export type RawPageMarkProcessedRequest = z.infer<typeof rawPageMarkProcessedRequestSchema>
