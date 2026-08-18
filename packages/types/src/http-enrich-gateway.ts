import { z } from 'zod'

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
