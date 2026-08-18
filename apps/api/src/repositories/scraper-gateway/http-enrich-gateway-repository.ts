import type { PrismaClient, Prisma } from '@wivwav/db'
import type {
  DealerCandidate,
  DealerEnrichSubmitRequest,
  InvestigationUpsertRequest,
  ManufacturerCommunicationUpsertRequest,
  ModelResearchSubmitRequest,
  RecallUpsertRequest,
  ComplaintUpsertRequest,
  SafetyRatingUpsertRequest,
  FuelEconomyMsrpUpsertRequest,
  VehicleModelSummary,
  VinEnrichCandidate,
  VinEnrichResolveRequest,
} from '@wivwav/types/http-enrich-gateway'

/**
 * DB read/write surface backing `/internal/scraper/http-enrich/*` (#963):
 * every Prisma call the 9 outbound-HTTP scraper jobs used to make directly
 * (apps/scraper/src/jobs/{nhtsa-*,vin-enrich,model-research,
 * fueleconomy-msrp,dealer-enrich}.ts) now lives here instead, reached over
 * HTTP by the worker handlers under apps/worker/src/handlers/. Deliberately
 * a separate class from SourceGatewayRepository — different tables,
 * different job family — sharing only the same `db`/auth boundary.
 */
/**
 * Same TTL as `LOCK_TTL_MS` in apps/scraper/src/jobs/listing-lock.ts — a
 * lock older than this is treated as abandoned (crashed worker, dropped
 * connection) and reclaimable by the next claim.
 */
const LOCK_TTL_MS = 10 * 60 * 1000

export class HttpEnrichGatewayRepository {
  constructor(private readonly db: PrismaClient) {}

  // --- shared vehicle-model reads ---

  async listVehicleModels(vehicleModelId?: string): Promise<VehicleModelSummary[]> {
    return this.db.vehicleModel.findMany({
      ...(vehicleModelId ? { where: { id: vehicleModelId } } : {}),
      select: { id: true, make: true, model: true, year: true },
    })
  }

  // --- nhtsa-recalls ---

  async upsertRecall(body: RecallUpsertRequest): Promise<void> {
    await this.db.recall.upsert({
      where: {
        nhtsaCampaignId_vehicleModelId: {
          nhtsaCampaignId: body.nhtsaCampaignId,
          vehicleModelId: body.vehicleModelId,
        },
      },
      update: {
        component: body.component,
        summary: body.summary,
        remedy: body.remedy,
        reportedAt: body.reportedAt,
        refreshedAt: new Date(),
      },
      create: {
        nhtsaCampaignId: body.nhtsaCampaignId,
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        remedy: body.remedy,
        reportedAt: body.reportedAt,
        refreshedAt: new Date(),
      },
    })
  }

  // --- nhtsa-complaints ---

  async upsertComplaint(body: ComplaintUpsertRequest): Promise<void> {
    await this.db.complaint.upsert({
      where: { nhtsaId: body.nhtsaId },
      update: {
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        mileage: body.mileage,
        crashInvolved: body.crashInvolved,
        reportedAt: body.reportedAt,
        refreshedAt: new Date(),
      },
      create: {
        nhtsaId: body.nhtsaId,
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        mileage: body.mileage,
        crashInvolved: body.crashInvolved,
        reportedAt: body.reportedAt,
        refreshedAt: new Date(),
      },
    })
  }

  // --- nhtsa-safety-ratings ---

  async upsertSafetyRating(body: SafetyRatingUpsertRequest): Promise<void> {
    await this.db.safetyRating.upsert({
      where: { nhtsaVehicleId: body.nhtsaVehicleId },
      update: {
        vehicleModelId: body.vehicleModelId,
        description: body.description,
        overallRating: body.overallRating,
        frontCrashRating: body.frontCrashRating,
        sideCrashRating: body.sideCrashRating,
        rolloverRating: body.rolloverRating,
        rolloverRatingText: body.rolloverRatingText,
        refreshedAt: new Date(),
      },
      create: {
        nhtsaVehicleId: body.nhtsaVehicleId,
        vehicleModelId: body.vehicleModelId,
        description: body.description,
        overallRating: body.overallRating,
        frontCrashRating: body.frontCrashRating,
        sideCrashRating: body.sideCrashRating,
        rolloverRating: body.rolloverRating,
        rolloverRatingText: body.rolloverRatingText,
      },
    })
  }

  // --- nhtsa-investigations ---

  async upsertInvestigation(body: InvestigationUpsertRequest): Promise<void> {
    await this.db.investigation.upsert({
      where: { nhtsaId: body.nhtsaId },
      update: {
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        openedDate: body.openedDate,
        closedDate: body.closedDate,
        outcome: body.outcome,
        sourceUrl: body.sourceUrl,
        refreshedAt: new Date(),
      },
      create: {
        nhtsaId: body.nhtsaId,
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        openedDate: body.openedDate,
        closedDate: body.closedDate,
        outcome: body.outcome,
        sourceUrl: body.sourceUrl,
      },
    })
  }

  // --- nhtsa-manufacturer-communications ---

  async upsertManufacturerCommunication(body: ManufacturerCommunicationUpsertRequest): Promise<void> {
    await this.db.manufacturerCommunication.upsert({
      where: { nhtsaId: body.nhtsaId },
      update: {
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        issuedDate: body.issuedDate,
        sourceUrl: body.sourceUrl,
        refreshedAt: new Date(),
      },
      create: {
        nhtsaId: body.nhtsaId,
        vehicleModelId: body.vehicleModelId,
        component: body.component,
        summary: body.summary,
        issuedDate: body.issuedDate,
        sourceUrl: body.sourceUrl,
      },
    })
  }

  // --- vin-enrich ---

  /**
   * Atomically claims up to `limit` unlinked-VIN listings by locking them in
   * one raw UPDATE, then reads back the claimed rows — same
   * lock-then-select shape as `acquireListingLock` in
   * apps/scraper/src/jobs/listing-lock.ts, batched.
   */
  async claimVinEnrichListings(limit: number): Promise<VinEnrichCandidate[]> {
    const now = new Date()
    const staleThreshold = new Date(now.getTime() - LOCK_TTL_MS)

    const claimed = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE listings
      SET "processingLockedAt" = ${now}
      WHERE id IN (
        SELECT id FROM listings
        WHERE vin IS NOT NULL
          AND "vehicleModelId" IS NULL
          AND ("processingLockedAt" IS NULL OR "processingLockedAt" < ${staleThreshold})
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
    if (claimed.length === 0) return []

    const listings = await this.db.listing.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
      select: { id: true, vin: true, make: true, model: true, year: true },
    })
    return listings
      .filter((listing): listing is typeof listing & { vin: string } => listing.vin !== null)
      .map((listing) => ({
        id: listing.id,
        vin: listing.vin,
        make: listing.make,
        model: listing.model,
        year: listing.year,
      }))
  }

  private async findOrCreateVehicleModel(
    make: string,
    model: string,
    year: number,
    trim: string | null,
    bodyType: string | null,
  ): Promise<{ id: string; confidence: 'exact' | 'trim_fallback' }> {
    let vehicleModel = await this.db.vehicleModel.findFirst({ where: { make, model, year, trim } })
    if (vehicleModel) {
      if (bodyType && !vehicleModel.bodyType) {
        vehicleModel = await this.db.vehicleModel.update({ where: { id: vehicleModel.id }, data: { bodyType } })
      }
      return { id: vehicleModel.id, confidence: 'exact' }
    }

    if (trim !== null) {
      const fallback = await this.db.vehicleModel.findFirst({ where: { make, model, year, trim: null } })
      if (fallback) return { id: fallback.id, confidence: 'trim_fallback' }
    }

    const created = await this.db.vehicleModel.create({ data: { make, model, year, trim, bodyType } })
    return { id: created.id, confidence: 'exact' }
  }

  /**
   * Applies a claimed listing's decode outcome and releases its lock. Mirrors
   * `runVinEnrichJob`'s per-listing branch in
   * apps/scraper/src/jobs/vin-enrich.ts, minus the resolution-queue enqueue
   * (the caller does that — it needs the `QueueAdapter`, not this repository).
   */
  async resolveVinEnrichListing(
    body: VinEnrichResolveRequest,
  ): Promise<{ vehicleModelId: string | null }> {
    try {
      if (body.outcome === 'enriched') {
        const { id: vehicleModelId } = await this.findOrCreateVehicleModel(
          body.decoded.make,
          body.decoded.model,
          body.decoded.year,
          body.decoded.trim,
          body.decoded.bodyType,
        )
        await this.db.listing.update({
          where: { id: body.listingId },
          data: {
            vehicleModelId,
            vehicleModelMatchConfidence: 'exact',
            publicationStatus: 'pending',
            qualityIssueCodes: [],
            qualityCheckedAt: null,
          },
        })
        return { vehicleModelId }
      }

      if (body.outcome === 'mismatched') {
        await this.db.listing.update({
          where: { id: body.listingId },
          data: {
            publicationStatus: 'quarantined',
            qualityIssueCodes: body.qualityIssueCodes,
            qualityCheckedAt: new Date(),
          },
        })
        return { vehicleModelId: null }
      }

      // outcome === 'failed': nothing to persist besides releasing the lock.
      return { vehicleModelId: null }
    } finally {
      await this.db.listing.update({ where: { id: body.listingId }, data: { processingLockedAt: null } })
    }
  }

  // --- model-research ---

  async listModelResearchPending(researchVersion: number): Promise<VehicleModelSummary[]> {
    const researched = await this.db.vehicleModelResearch.findMany({
      where: { researchVersion },
      select: { vehicleModelId: true },
    })
    const researchedIds = researched.map((r) => r.vehicleModelId)
    return this.db.vehicleModel.findMany({
      ...(researchedIds.length > 0 ? { where: { id: { notIn: researchedIds } } } : {}),
      select: { id: true, make: true, model: true, year: true },
    })
  }

  async submitModelResearch(body: ModelResearchSubmitRequest): Promise<{ created: boolean }> {
    let research: { id: string; sources: Array<{ id: string; sourceName: string }> }
    try {
      research = await this.db.vehicleModelResearch.create({
        data: {
          vehicleModelId: body.vehicleModelId,
          researchVersion: body.researchVersion,
          researchedAt: new Date(),
          sources: {
            create: [{ sourceName: body.sourceName, sourceUrl: body.sourceUrl, fetchedAt: new Date() }],
          },
        },
        include: { sources: { select: { id: true, sourceName: true } } },
      })
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        return { created: false }
      }
      throw err
    }

    const source = research.sources.find((s) => s.sourceName === body.sourceName)
    if (body.claims.length > 0) {
      await this.db.vehicleModelClaim.createMany({
        data: body.claims.map((claim) => ({
          researchId: research.id,
          field: claim.field,
          claimText: claim.claimText,
          confidence: claim.confidence,
          sourceId: source?.id ?? null,
        })),
      })
    }
    return { created: true }
  }

  // --- fueleconomy-msrp ---

  async upsertFuelEconomyMsrp(body: FuelEconomyMsrpUpsertRequest): Promise<void> {
    // Prisma's Json? column requires InputJsonValue, not `| undefined`, under
    // exactOptionalPropertyTypes — omit the key entirely when there is no
    // payload (mirrors the same guard in submitDealerEnrich's `hours` field).
    const sourcePayload = body.sourcePayload as Prisma.InputJsonValue | null
    await this.db.vehicleModelPricing.upsert({
      where: { vehicleModelId: body.vehicleModelId },
      update: {
        originalMsrpCents: body.originalMsrpCents,
        sourceName: 'fueleconomy.gov (U.S. Dept. of Energy)',
        sourceUrl: body.sourceUrl,
        sourceFetchedAt: new Date(),
        ...(sourcePayload !== null ? { sourcePayload } : {}),
        updatedAt: new Date(),
      },
      create: {
        vehicleModelId: body.vehicleModelId,
        originalMsrpCents: body.originalMsrpCents,
        sourceName: 'fueleconomy.gov (U.S. Dept. of Energy)',
        sourceUrl: body.sourceUrl,
        sourceFetchedAt: new Date(),
        ...(sourcePayload !== null ? { sourcePayload } : {}),
      },
    })
  }

  // --- dealer-enrich ---

  async listDealerEnrichPending(limit: number, staleThreshold: Date): Promise<DealerCandidate[]> {
    const rawDealers = await this.db.listing.findMany({
      where: { dealerName: { not: null }, zip: { not: null }, sellerType: 'dealer' },
      select: { dealerName: true, zip: true },
      distinct: ['dealerName', 'zip'],
      take: limit * 4,
    })

    const toEnrich: DealerCandidate[] = []
    for (const row of rawDealers) {
      if (!row.dealerName || !row.zip) continue
      const existing = await this.db.dealerProfile.findUnique({
        where: { name_zip: { name: row.dealerName, zip: row.zip } },
        select: { id: true, enrichedAt: true },
      })
      if (!existing || !existing.enrichedAt || existing.enrichedAt < staleThreshold) {
        toEnrich.push({ dealerName: row.dealerName, zip: row.zip })
      }
      if (toEnrich.length >= limit) break
    }
    return toEnrich
  }

  async submitDealerEnrich(body: DealerEnrichSubmitRequest): Promise<{ dealerId: string }> {
    const hours = body.hours as Prisma.InputJsonValue | null | undefined
    const profile = hours
      ? await this.db.dealerProfile.upsert({
          where: { name_zip: { name: body.dealerName, zip: body.zip } },
          create: {
            name: body.dealerName,
            zip: body.zip,
            googlePlaceId: body.googlePlaceId,
            rating: body.rating,
            reviewCount: body.reviewCount,
            hours,
            enrichedAt: new Date(),
          },
          update: {
            googlePlaceId: body.googlePlaceId,
            rating: body.rating,
            reviewCount: body.reviewCount,
            hours,
            enrichedAt: new Date(),
          },
        })
      : await this.db.dealerProfile.upsert({
          where: { name_zip: { name: body.dealerName, zip: body.zip } },
          create: {
            name: body.dealerName,
            zip: body.zip,
            googlePlaceId: body.googlePlaceId,
            rating: body.rating,
            reviewCount: body.reviewCount,
            enrichedAt: new Date(),
          },
          update: {
            googlePlaceId: body.googlePlaceId,
            rating: body.rating,
            reviewCount: body.reviewCount,
            enrichedAt: new Date(),
          },
        })

    for (const review of body.reviews) {
      await this.db.dealerReview.upsert({
        where: {
          dealerId_source_publishedAt_authorName: {
            dealerId: profile.id,
            source: 'google',
            publishedAt: review.publishedAt,
            authorName: review.authorName,
          },
        },
        create: {
          dealerId: profile.id,
          authorName: review.authorName,
          rating: review.rating,
          text: review.text,
          publishedAt: review.publishedAt,
          source: 'google',
        },
        update: { rating: review.rating, text: review.text },
      })
    }

    await this.db.listing.updateMany({
      where: { dealerName: body.dealerName, zip: body.zip },
      data: { dealerProfileId: profile.id },
    })

    return { dealerId: profile.id }
  }
}
