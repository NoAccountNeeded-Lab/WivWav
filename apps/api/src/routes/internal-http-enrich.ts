import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@wivwav/db'
import { CRITICAL_JOB_OPTIONS, type QueueFactory, QUEUES } from '@wivwav/queue'
import {
  vehicleModelListRequestSchema,
  recallUpsertRequestSchema,
  complaintUpsertRequestSchema,
  safetyRatingUpsertRequestSchema,
  investigationUpsertRequestSchema,
  manufacturerCommunicationUpsertRequestSchema,
  vinEnrichClaimRequestSchema,
  vinEnrichResolveRequestSchema,
  modelResearchPendingRequestSchema,
  modelResearchSubmitRequestSchema,
  fuelEconomyMsrpUpsertRequestSchema,
  dealerEnrichPendingRequestSchema,
  dealerEnrichSubmitRequestSchema,
} from '@wivwav/types/http-enrich-gateway'
import type { WivWavLogger } from '@wivwav/logger'
import { HttpEnrichGatewayRepository } from '../repositories/scraper-gateway/http-enrich-gateway-repository.js'

export interface InternalHttpEnrichRoutesOptions {
  db: PrismaClient
  queueFactory: QueueFactory
  logger?: WivWavLogger
}

/**
 * HTTP ingest surface for the `httpEnrich`-capability worker-gateway lane
 * (#962/#963): every DB read/write the 9 outbound-HTTP scraper jobs used to
 * make directly through Prisma. Mounted at
 * `/internal/scraper/http-enrich`, inside the same bearer-auth scope as
 * `internalScraperRoutes` (see app.ts) — same coordinator, a separate file
 * because it is a distinct job family with its own tables.
 */
export const internalHttpEnrichRoutes: FastifyPluginAsync<InternalHttpEnrichRoutesOptions> = async (
  app,
  { db, queueFactory },
) => {
  const repo = new HttpEnrichGatewayRepository(db)
  const resolutionQueue = queueFactory.createQueue(QUEUES.LISTING_RESOLVE)

  // --- shared vehicle-model reads ---

  app.post('/vehicle-models/list', async (req, reply) => {
    const body = vehicleModelListRequestSchema.parse(req.body)
    const vehicleModels = await repo.listVehicleModels(body.vehicleModelId)
    return reply.send({ data: { vehicleModels } })
  })

  // --- nhtsa-recalls ---

  app.post('/recalls/upsert', async (req, reply) => {
    const body = recallUpsertRequestSchema.parse(req.body)
    await repo.upsertRecall(body)
    return reply.send({ data: { ok: true } })
  })

  // --- nhtsa-complaints ---

  app.post('/complaints/upsert', async (req, reply) => {
    const body = complaintUpsertRequestSchema.parse(req.body)
    await repo.upsertComplaint(body)
    return reply.send({ data: { ok: true } })
  })

  // --- nhtsa-safety-ratings ---

  app.post('/safety-ratings/upsert', async (req, reply) => {
    const body = safetyRatingUpsertRequestSchema.parse(req.body)
    await repo.upsertSafetyRating(body)
    return reply.send({ data: { ok: true } })
  })

  // --- nhtsa-investigations ---

  app.post('/investigations/upsert', async (req, reply) => {
    const body = investigationUpsertRequestSchema.parse(req.body)
    await repo.upsertInvestigation(body)
    return reply.send({ data: { ok: true } })
  })

  // --- nhtsa-manufacturer-communications ---

  app.post('/manufacturer-communications/upsert', async (req, reply) => {
    const body = manufacturerCommunicationUpsertRequestSchema.parse(req.body)
    await repo.upsertManufacturerCommunication(body)
    return reply.send({ data: { ok: true } })
  })

  // --- vin-enrich ---

  app.post('/vin-enrich/claim', async (req, reply) => {
    const body = vinEnrichClaimRequestSchema.parse(req.body)
    const listings = await repo.claimVinEnrichListings(body.limit)
    return reply.send({ data: { listings } })
  })

  app.post('/vin-enrich/resolve', async (req, reply) => {
    const body = vinEnrichResolveRequestSchema.parse(req.body)
    const { vehicleModelId } = await repo.resolveVinEnrichListing(body)
    // Guarantee a path back to eligible/quarantined (#652) — mirrors the
    // unconditional enqueue in the vin-enrich handler's success branch
    // (apps/worker/src/handlers/vin-enrich.ts, formerly runVinEnrichJob in
    // apps/scraper/src/jobs/vin-enrich.ts before #964's cutover). Mismatched/
    // failed outcomes don't gain a new vehicle-model link, so there is
    // nothing new for resolution to reconsider.
    if (body.outcome === 'enriched') {
      await resolutionQueue.add(
        {
          listingId: body.listingId,
          observationReference: `vin-enrich:${body.listingId}:${new Date().toISOString()}`,
          parentRunId: null,
        },
        CRITICAL_JOB_OPTIONS,
      )
    }
    return reply.send({ data: { vehicleModelId } })
  })

  // --- model-research ---

  app.post('/model-research/pending', async (req, reply) => {
    const body = modelResearchPendingRequestSchema.parse(req.body)
    const vehicleModels = await repo.listModelResearchPending(body.researchVersion)
    return reply.send({ data: { vehicleModels } })
  })

  app.post('/model-research/submit', async (req, reply) => {
    const body = modelResearchSubmitRequestSchema.parse(req.body)
    const result = await repo.submitModelResearch(body)
    return reply.send({ data: result })
  })

  // --- fueleconomy-msrp ---

  app.post('/fueleconomy-msrp/upsert', async (req, reply) => {
    const body = fuelEconomyMsrpUpsertRequestSchema.parse(req.body)
    await repo.upsertFuelEconomyMsrp(body)
    return reply.send({ data: { ok: true } })
  })

  // --- dealer-enrich ---

  app.post('/dealer-enrich/pending', async (req, reply) => {
    const body = dealerEnrichPendingRequestSchema.parse(req.body)
    const dealers = await repo.listDealerEnrichPending(body.limit, body.staleThreshold)
    return reply.send({ data: { dealers } })
  })

  app.post('/dealer-enrich/submit', async (req, reply) => {
    const body = dealerEnrichSubmitRequestSchema.parse(req.body)
    const result = await repo.submitDealerEnrich(body)
    return reply.send({ data: result })
  })
}
