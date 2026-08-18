import { z } from 'zod'
import { isoDateTimeSchema } from './wire-date.js'

/**
 * Dispatch payload/result contracts for the outbound-HTTP-only scraper job
 * types (#962, #960 phase 2): jobs that call `fetchWithRetry` against a
 * public/keyed HTTP API and have no Chromium/DOM dependency, so they route
 * through the worker-gateway's `httpEnrich` capability lane
 * (`workerCapabilitiesSchema` in ./worker-protocol.js) instead of the
 * `chromium` lane the phase-1 SOURCE_SCRAPE/DETAIL_CRAWL/DETAIL_EXTRACT job
 * types use (./scraper-gateway.js).
 *
 * Each payload schema mirrors the `JobData` interface its
 * `apps/scraper/src/jobs` counterpart declares today. The DB
 * read/write contracts these jobs will need once they run on a worker with
 * no direct `@wivwav/db` access (mirroring the detailCrawl/detailExtract
 * request/response groups in ./scraper-gateway.js) are out of scope here —
 * those land with the worker handlers, the next step in the #960 phase-2
 * sequence. `result` is deliberately minimal (a single processed count) since
 * none of these job types drive follow-on queue behavior the way
 * SOURCE_SCRAPE's `listingsChanged` does.
 */

/**
 * Shared by the job types that scope one run to a single VehicleModel via an
 * optional `vehicleModelId` — omitted, they run against every model.
 */
export const vehicleModelEnrichJobPayloadSchema = z.object({
  vehicleModelId: z.string().min(1).optional(),
})
export type VehicleModelEnrichJobPayload = z.infer<typeof vehicleModelEnrichJobPayloadSchema>

/**
 * Shared by the job types that always run against every eligible record —
 * no per-run scoping exists today.
 */
export const unscopedEnrichJobPayloadSchema = z.object({})
export type UnscopedEnrichJobPayload = z.infer<typeof unscopedEnrichJobPayloadSchema>

/** Shared result shape: count of records the job upserted/enriched. */
const enrichJobResultSchema = z.object({
  processed: z.number().int().nonnegative(),
})
export type EnrichJobResult = z.infer<typeof enrichJobResultSchema>

// --- nhtsa-recalls (api.nhtsa.gov) ---

export const nhtsaRecallsJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type NhtsaRecallsJobPayload = VehicleModelEnrichJobPayload
export const nhtsaRecallsJobResultSchema = enrichJobResultSchema
export type NhtsaRecallsJobResult = EnrichJobResult

// --- nhtsa-complaints (api.nhtsa.gov) ---

export const nhtsaComplaintsJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type NhtsaComplaintsJobPayload = VehicleModelEnrichJobPayload
export const nhtsaComplaintsJobResultSchema = enrichJobResultSchema
export type NhtsaComplaintsJobResult = EnrichJobResult

// --- nhtsa-safety-ratings (api.nhtsa.gov) ---

export const nhtsaSafetyRatingsJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type NhtsaSafetyRatingsJobPayload = VehicleModelEnrichJobPayload
export const nhtsaSafetyRatingsJobResultSchema = enrichJobResultSchema
export type NhtsaSafetyRatingsJobResult = EnrichJobResult

// --- nhtsa-investigations (www.nhtsa.gov) ---

export const nhtsaInvestigationsJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type NhtsaInvestigationsJobPayload = VehicleModelEnrichJobPayload
export const nhtsaInvestigationsJobResultSchema = enrichJobResultSchema
export type NhtsaInvestigationsJobResult = EnrichJobResult

// --- nhtsa-manufacturer-communications (www.nhtsa.gov) ---

export const nhtsaManufacturerCommunicationsJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type NhtsaManufacturerCommunicationsJobPayload = VehicleModelEnrichJobPayload
export const nhtsaManufacturerCommunicationsJobResultSchema = enrichJobResultSchema
export type NhtsaManufacturerCommunicationsJobResult = EnrichJobResult

// --- vin-enrich (vpic.nhtsa.dot.gov) ---

export const vinEnrichJobPayloadSchema = unscopedEnrichJobPayloadSchema
export type VinEnrichJobPayload = UnscopedEnrichJobPayload
export const vinEnrichJobResultSchema = enrichJobResultSchema
export type VinEnrichJobResult = EnrichJobResult

// --- model-research (www.fueleconomy.gov) ---

export const modelResearchJobPayloadSchema = unscopedEnrichJobPayloadSchema
export type ModelResearchJobPayload = UnscopedEnrichJobPayload
export const modelResearchJobResultSchema = enrichJobResultSchema
export type ModelResearchJobResult = EnrichJobResult

// --- fueleconomy-msrp (www.fueleconomy.gov) ---

export const fuelEconomyMsrpJobPayloadSchema = vehicleModelEnrichJobPayloadSchema
export type FuelEconomyMsrpJobPayload = VehicleModelEnrichJobPayload
export const fuelEconomyMsrpJobResultSchema = enrichJobResultSchema
export type FuelEconomyMsrpJobResult = EnrichJobResult

// --- dealer-enrich (maps.googleapis.com) ---

export const dealerEnrichJobPayloadSchema = unscopedEnrichJobPayloadSchema
export type DealerEnrichJobPayload = UnscopedEnrichJobPayload
export const dealerEnrichJobResultSchema = enrichJobResultSchema
export type DealerEnrichJobResult = EnrichJobResult

/**
 * DB read/write contracts for the 9 http-enrich job handlers (#963), mounted
 * at `/internal/scraper/http-enrich/*` (see apps/api's
 * internal-http-enrich.ts). These are the pieces the docstring above calls
 * "out of scope" for #962 — the worker handlers have no `@wivwav/db` access,
 * so every read and write these jobs used to do directly through Prisma
 * (apps/scraper/src/jobs/{nhtsa-*,vin-enrich,model-research,fueleconomy-msrp,
 * dealer-enrich}.ts) now round-trips through one of these request/response
 * pairs instead.
 */

const vehicleModelSummarySchema = z.object({
  id: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})
export type VehicleModelSummary = z.infer<typeof vehicleModelSummarySchema>

/** Shared by every job scoped by `vehicleModelEnrichJobPayloadSchema`. */
export const vehicleModelListRequestSchema = z.object({
  vehicleModelId: z.string().min(1).optional(),
})
export type VehicleModelListRequest = z.infer<typeof vehicleModelListRequestSchema>

export const vehicleModelListResponseSchema = z.object({
  vehicleModels: z.array(vehicleModelSummarySchema),
})
export type VehicleModelListResponse = z.infer<typeof vehicleModelListResponseSchema>

// --- nhtsa-recalls ---

export const recallUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  nhtsaCampaignId: z.string().min(1),
  component: z.string(),
  summary: z.string(),
  remedy: z.string().nullable(),
  reportedAt: isoDateTimeSchema,
})
export type RecallUpsertRequest = z.infer<typeof recallUpsertRequestSchema>

// --- nhtsa-complaints ---

export const complaintUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  nhtsaId: z.string().min(1),
  component: z.string(),
  summary: z.string(),
  mileage: z.number().int().nullable(),
  crashInvolved: z.boolean(),
  reportedAt: isoDateTimeSchema,
})
export type ComplaintUpsertRequest = z.infer<typeof complaintUpsertRequestSchema>

// --- nhtsa-safety-ratings ---

export const safetyRatingUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  nhtsaVehicleId: z.number().int(),
  description: z.string().nullable(),
  overallRating: z.number().int().nullable(),
  frontCrashRating: z.number().int().nullable(),
  sideCrashRating: z.number().int().nullable(),
  rolloverRating: z.number().int().nullable(),
  rolloverRatingText: z.string().nullable(),
})
export type SafetyRatingUpsertRequest = z.infer<typeof safetyRatingUpsertRequestSchema>

// --- nhtsa-investigations ---

export const investigationUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  nhtsaId: z.string().min(1),
  component: z.string(),
  summary: z.string(),
  openedDate: isoDateTimeSchema,
  closedDate: isoDateTimeSchema.nullable(),
  outcome: z.string().nullable(),
  sourceUrl: z.string(),
})
export type InvestigationUpsertRequest = z.infer<typeof investigationUpsertRequestSchema>

// --- nhtsa-manufacturer-communications ---

export const manufacturerCommunicationUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  nhtsaId: z.string().min(1),
  component: z.string(),
  summary: z.string(),
  issuedDate: isoDateTimeSchema,
  sourceUrl: z.string(),
})
export type ManufacturerCommunicationUpsertRequest = z.infer<
  typeof manufacturerCommunicationUpsertRequestSchema
>

// --- vin-enrich ---

/**
 * Claims up to `limit` unlinked-VIN listings (`vehicleModelId: null`, not
 * held by another job's row lock) and atomically marks them locked
 * server-side — mirrors `acquireListingLock`'s atomic `UPDATE ... WHERE` from
 * `apps/scraper/src/jobs/listing-lock.ts`, now applied to the whole batch in
 * one gateway call instead of one row at a time in-process.
 */
export const vinEnrichClaimRequestSchema = z.object({
  limit: z.number().int().positive(),
})
export type VinEnrichClaimRequest = z.infer<typeof vinEnrichClaimRequestSchema>

const vinEnrichCandidateSchema = z.object({
  id: z.string(),
  vin: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})
export type VinEnrichCandidate = z.infer<typeof vinEnrichCandidateSchema>

export const vinEnrichClaimResponseSchema = z.object({
  listings: z.array(vinEnrichCandidateSchema),
})
export type VinEnrichClaimResponse = z.infer<typeof vinEnrichClaimResponseSchema>

/**
 * Applies one claimed listing's outcome and releases its lock — the
 * vehicle-model find-or-create, the listing update, and the
 * LISTING_RESOLVE enqueue all need `@wivwav/db`/`@wivwav/queue`, so (unlike
 * the pure `validateAuthoritativeMismatch` comparison, which stays in the
 * worker handler) they run server-side atomically per listing.
 */
export const vinEnrichResolveRequestSchema = z.discriminatedUnion('outcome', [
  z.object({
    listingId: z.string().min(1),
    outcome: z.literal('enriched'),
    decoded: z.object({
      make: z.string().min(1),
      model: z.string().min(1),
      year: z.number().int(),
      trim: z.string().nullable(),
      bodyType: z.string().nullable(),
    }),
  }),
  z.object({
    listingId: z.string().min(1),
    outcome: z.literal('mismatched'),
    qualityIssueCodes: z.array(z.string()),
  }),
  z.object({
    listingId: z.string().min(1),
    outcome: z.literal('failed'),
  }),
])
export type VinEnrichResolveRequest = z.infer<typeof vinEnrichResolveRequestSchema>

// --- model-research ---

export const modelResearchPendingRequestSchema = z.object({
  researchVersion: z.number().int().positive(),
})
export type ModelResearchPendingRequest = z.infer<typeof modelResearchPendingRequestSchema>

export const modelResearchPendingResponseSchema = z.object({
  vehicleModels: z.array(vehicleModelSummarySchema),
})
export type ModelResearchPendingResponse = z.infer<typeof modelResearchPendingResponseSchema>

const modelResearchClaimInputSchema = z.object({
  field: z.string(),
  claimText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})

/**
 * Creates the `VehicleModelResearch` + `VehicleModelSource` + claim rows in
 * one call. `created: false` means a concurrent worker already wrote this
 * (vehicleModelId, researchVersion) pair — mirrors the original job's P2002
 * catch-and-skip.
 */
export const modelResearchSubmitRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  researchVersion: z.number().int().positive(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  claims: z.array(modelResearchClaimInputSchema),
})
export type ModelResearchSubmitRequest = z.infer<typeof modelResearchSubmitRequestSchema>

export const modelResearchSubmitResponseSchema = z.object({
  created: z.boolean(),
})
export type ModelResearchSubmitResponse = z.infer<typeof modelResearchSubmitResponseSchema>

// --- fueleconomy-msrp ---

export const fuelEconomyMsrpUpsertRequestSchema = z.object({
  vehicleModelId: z.string().min(1),
  originalMsrpCents: z.number().int().positive(),
  sourceUrl: z.string(),
  sourcePayload: z.unknown().nullable(),
})
export type FuelEconomyMsrpUpsertRequest = z.infer<typeof fuelEconomyMsrpUpsertRequestSchema>

// --- dealer-enrich ---

export const dealerEnrichPendingRequestSchema = z.object({
  limit: z.number().int().positive(),
  staleThreshold: isoDateTimeSchema,
})
export type DealerEnrichPendingRequest = z.infer<typeof dealerEnrichPendingRequestSchema>

const dealerCandidateSchema = z.object({
  dealerName: z.string(),
  zip: z.string(),
})
export type DealerCandidate = z.infer<typeof dealerCandidateSchema>

export const dealerEnrichPendingResponseSchema = z.object({
  dealers: z.array(dealerCandidateSchema),
})
export type DealerEnrichPendingResponse = z.infer<typeof dealerEnrichPendingResponseSchema>

const dealerReviewInputSchema = z.object({
  authorName: z.string(),
  rating: z.number().int(),
  text: z.string(),
  publishedAt: isoDateTimeSchema,
})

/** Upserts the dealer profile + top reviews and links every matching listing to it. */
export const dealerEnrichSubmitRequestSchema = z.object({
  dealerName: z.string().min(1),
  zip: z.string().min(1),
  googlePlaceId: z.string().min(1),
  rating: z.number().nullable(),
  reviewCount: z.number().int().nullable(),
  hours: z.unknown().nullable(),
  reviews: z.array(dealerReviewInputSchema),
})
export type DealerEnrichSubmitRequest = z.infer<typeof dealerEnrichSubmitRequestSchema>

export const dealerEnrichSubmitResponseSchema = z.object({
  dealerId: z.string(),
})
export type DealerEnrichSubmitResponse = z.infer<typeof dealerEnrichSubmitResponseSchema>
