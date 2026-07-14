import { randomUUID } from 'node:crypto'
import type { PrismaClient, Listing, Prisma } from '@wivwav/db'

// Mirrors STALE_DETAIL_DAYS in apps/scraper/src/jobs/detail-crawl.ts — a
// listing whose detail page was last crawled longer ago than this is treated
// as pending re-crawl, same as the job itself would pick it up again.
const STALE_DETAIL_CRAWL_DAYS = 30

// ── Shape types ──────────────────────────────────────────────────────────────

export type ListingWithSource = Listing & {
  source: { name: string; baseUrl: string } | null
}

export type CrossListingRow = Pick<
  Listing,
  | 'id'
  | 'sourceUrl'
  | 'buyerUrl'
  | 'sellerType'
  | 'priceCents'
  | 'zip'
  | 'city'
  | 'state'
  | 'dealerName'
  | 'dealerPhone'
  | 'dealerWebsite'
>

export type ListingSafetyResult = {
  id: string
  vehicleModelId: string | null
}

export type SafetyRecallRow = {
  id: string
  nhtsaCampaignId: string
  component: string
  summary: string
  remedy: string | null
  reportedAt: Date
}

export type SafetyComplaintRow = {
  id: string
  nhtsaId: string
  component: string
  summary: string
  mileage: number | null
  crashInvolved: boolean
  reportedAt: Date
}

export type SafetyRatingRow = {
  id: string
  nhtsaVehicleId: string | null
  description: string | null
  overallRating: string | null
  frontCrashRating: string | null
  sideCrashRating: string | null
  rolloverRating: string | null
  rolloverRatingText: string | null
  refreshedAt: Date | null
}

export type InvestigationRow = {
  id: string
  nhtsaId: string
  component: string
  summary: string
  openedDate: Date
  closedDate: Date | null
  outcome: string | null
  sourceUrl: string
  refreshedAt: Date
}

export type ManufacturerCommunicationRow = {
  id: string
  nhtsaId: string
  component: string
  summary: string
  issuedDate: Date
  sourceUrl: string
  refreshedAt: Date
}

export type VehicleModelWithSafetyData = {
  id: string
  make: string
  model: string
  year: number
  trim: string | null
  bodyType: string | null
  recalls: SafetyRecallRow[]
  complaints: SafetyComplaintRow[]
  safetyRatings: SafetyRatingRow[]
  investigations: InvestigationRow[]
  manufacturerCommunications: ManufacturerCommunicationRow[]
}

export type PriceHistoryRow = {
  id: string
  priceCents: number
  recordedAt: Date
}

export type ListingVinRow = {
  id: string
  conversionManufacturer: string | null
}

/** Row for `GET /v1/vin/:vin/listings`. */
export type VinListingRow = {
  id: string
  sourceUrl: string
  dealerName: string | null
  priceCents: number | null
  mileage: number | null
  status: string
  listedAt: Date
  goneAt: Date | null
  soldAt: Date | null
}

export type VinHistoryEntryType = 'price' | 'mileage'

/** One price or mileage observation, merged across all listings matching a VIN. */
export type VinHistoryRow = {
  listingId: string
  type: VinHistoryEntryType
  /** Cents for `type: 'price'`, odometer reading for `type: 'mileage'`. */
  value: number
  recordedAt: Date
}

export type DealerReviewRow = {
  id: string
  authorName: string
  rating: number
  text: string
  publishedAt: Date
  source: string
}

export type DealerProfileResult = {
  id: string
  name: string
  zip: string
  googlePlaceId: string | null
  rating: number | null
  reviewCount: number | null
  /** Raw JSON from Google Places opening_hours — shape varies by API version. */
  hours: Prisma.JsonValue | null
  enrichedAt: Date | null
  reviews: DealerReviewRow[]
}

export type ListingDealerResult = {
  id: string
  dealerProfileId: string | null
}

export type ListingPublicationCountRow = {
  sourceId: string
  observedActive: number
  eligibleActive: number
  /** Listings currently in possibly_gone state — an elevated count indicates index-absence. */
  possiblyGoneCount: number
}

/**
 * Operator-facing quarantine row. Retains exactly the fields the AC requires
 * for repair: source URL, source record key, observation time, extractor
 * version (from the most recent listing_observation row), and rule IDs.
 * Deliberately excludes free-text fields (description) that could carry
 * unnecessary personal data for private-seller listings.
 */
export type QuarantinedListingRow = {
  id: string
  sourceId: string
  sourceName: string
  sourceUrl: string
  sourceRecordKey: string
  make: string
  model: string
  year: number
  qualityIssueCodes: string[]
  qualityCheckedAt: Date | null
  scrapedAt: Date
  updatedAt: Date
  /**
   * extractionVersion of the listing's most recent ListingObservation row, or
   * null if the listing has no observation history yet. Needed for repair:
   * an operator fixing a quarantined row needs to know which extractor logic
   * produced the bad data.
   */
  extractionVersion: string | null
}

export type QuarantineFilter = {
  sourceId?: string
  /**
   * Matches if ANY of the listing's qualityIssueCodes intersects this rule
   * (or set of rules — passing an array lets callers filter by severity,
   * which resolves to "any rule with that severity").
   */
  rule?: string | string[]
  /** Only rows whose qualityCheckedAt (or scrapedAt if null) is at least this old. */
  olderThanMs?: number
  skip?: number
  take?: number
}

/**
 * One #499 field currently at `conflicting` resolution for one listing, with
 * the competing claims that caused it — for the operator triage surface
 * (`GET /admin/field-conflicts`). Deliberately excludes free-text evidence
 * (e.g. a description snippet) — only the normalized claimed values, their
 * provenance category, and observation times are exposed, so no
 * private-seller description text or model reasoning leaks into ops
 * tooling. `competingValues`/`evidenceKinds`/`sourceRefs`/`observedAts` are
 * parallel arrays, one entry per competing claim (already deduped to the
 * latest claim per evidence slot, mirroring the resolver).
 */
export type FieldConflictRow = {
  listingId: string
  sourceUrl: string
  make: string
  model: string
  year: number
  field: string
  competingValues: string[]
  evidenceKinds: string[]
  sourceRefs: (string | null)[]
  observedAts: Date[]
  /** Most recent Listing write that could have changed this resolution. */
  detectedAt: Date
}

export type FieldConflictFilter = {
  sourceId?: string
  /** Restricts to one field ("conversionType" | "rampType"); omit for both. */
  field?: string
  skip?: number
  take?: number
}

export type ListingReportType = 'specs_incorrect' | 'sold_or_stale' | 'duplicate' | 'other'

export type CreateListingReportInput = {
  listingId: string
  reportType: ListingReportType
  notes?: string | null
}

export type ListingReportRow = {
  id: string
  listingId: string
  reportType: ListingReportType
  notes: string | null
  status: 'unresolved' | 'resolved'
  reportedAt: Date
}

export type ListingReportTriageRow = {
  listingId: string
  sourceUrl: string
  make: string
  model: string
  year: number
  unresolvedCount: number
  latestReportedAt: Date
  reportTypes: ListingReportType[]
}

export type ListingReportTriageFilter = {
  minReports?: number
  skip?: number
  take?: number
}

type CountRow = {
  count: number | bigint
}

/**
 * Per-stage pending/last-completed state for one pipeline stage, scoped to a
 * single source. `pendingCount` is the number of rows that still need this
 * stage's work; `lastCompletedAt` is the most recent time this stage
 * finished work for the source (null if it has never completed any).
 */
export type SourcePipelineStageRow = {
  stage: 'detail-crawl' | 'detail-extract' | 'geocode' | 'vin-enrich'
  pendingCount: number
  lastCompletedAt: Date | null
}

type PublicationCountQueryRow = {
  sourceId: string
  observedActive: number | bigint
  eligibleActive: number | bigint
  possiblyGoneCount: number | bigint
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ListingRepository {
  findById(id: string): Promise<ListingWithSource | null>
  findCrossListingsByVehicleId(vehicleId: string, excludeListingId: string): Promise<CrossListingRow[]>
  findByIdForSafety(id: string): Promise<ListingSafetyResult | null>
  findByIdForDealer(id: string): Promise<ListingDealerResult | null>
  findDealerProfile(dealerProfileId: string): Promise<DealerProfileResult | null>
  findByVin(vin: string): Promise<ListingVinRow | null>
  /**
   * All listings matching a VIN across sources, for the cross-listing detail
   * page feature. `activeOnly` restricts to publication-eligible active
   * listings — the FREE-tier shape used by `GET /v1/vin/:vin/listings`.
   */
  findListingsByVin(vin: string, activeOnly: boolean): Promise<VinListingRow[]>
  /**
   * Merged price + mileage history for every listing matching a VIN,
   * ordered by `recordedAt` ascending. PRO-gated — see `GET /v1/vin/:vin/history`.
   */
  findHistoryByVin(vin: string): Promise<VinHistoryRow[]>
  findVehicleModelWithSafetyData(vehicleModelId: string): Promise<VehicleModelWithSafetyData | null>
  findManyActive(skip: number, take: number): Promise<Listing[]>
  countObservedActive(): Promise<number>
  countActive(): Promise<number>
  countActiveWithCoordinates(): Promise<number>
  countActiveMissingCoordinates(): Promise<number>
  getPublicationCountsBySource(): Promise<ListingPublicationCountRow[]>
  findPriceHistory(listingId: string): Promise<PriceHistoryRow[]>
  /** Lists quarantined listings, optionally filtered by source, rule, and age. */
  findQuarantined(filter: QuarantineFilter): Promise<QuarantinedListingRow[]>
  countQuarantined(filter: Omit<QuarantineFilter, 'skip' | 'take'>): Promise<number>
  /**
   * Resets a quarantined listing to 'pending' so the next validator pass
   * re-evaluates it (e.g. after an operator corrects upstream data or a
   * source fix ships). Returns false if the listing was not quarantined.
   */
  reprocessQuarantined(id: string): Promise<boolean>
  /**
   * #499 operator triage surface: active listings whose conversionType or
   * rampType resolution is `conflicting`, with the competing claims that
   * caused it.
   */
  findFieldConflicts(filter: FieldConflictFilter): Promise<FieldConflictRow[]>
  countFieldConflicts(filter: Omit<FieldConflictFilter, 'skip' | 'take'>): Promise<number>
  createListingReport(input: CreateListingReportInput): Promise<ListingReportRow>
  countUnresolvedReports(listingId: string): Promise<number>
  findListingReportTriage(filter: ListingReportTriageFilter): Promise<ListingReportTriageRow[]>
  countListingReportTriage(filter: Omit<ListingReportTriageFilter, 'skip' | 'take'>): Promise<number>
  /**
   * Per-stage pending/last-completed state for a single source, covering the
   * DB-derivable pipeline stages (detail-crawl, detail-extract, geocode,
   * vin-enrich). Stage pending conditions mirror the job queries in
   * apps/scraper/src/jobs/*.ts so the counts stay consistent with what a job
   * run would actually pick up.
   */
  getSourcePipelineStages(sourceId: string): Promise<SourcePipelineStageRow[]>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<ListingWithSource | null> {
    return this.db.listing.findFirst({
      where: {
        id,
        status: 'active',
        publicationStatus: 'eligible',
      },
      include: { source: { select: { name: true, baseUrl: true } } },
    })
  }

  findCrossListingsByVehicleId(vehicleId: string, excludeListingId: string): Promise<CrossListingRow[]> {
    return this.db.listing.findMany({
      where: {
        vehicleId,
        status: 'active',
        publicationStatus: 'eligible',
        id: { not: excludeListingId },
      },
      orderBy: [
        { listedAt: 'desc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        sourceUrl: true,
        buyerUrl: true,
        sellerType: true,
        priceCents: true,
        zip: true,
        city: true,
        state: true,
        dealerName: true,
        dealerPhone: true,
        dealerWebsite: true,
      },
    })
  }

  findByIdForSafety(id: string): Promise<ListingSafetyResult | null> {
    return this.db.listing.findFirst({
      where: {
        id,
        status: 'active',
        publicationStatus: 'eligible',
      },
      select: { id: true, vehicleModelId: true },
    })
  }

  findByIdForDealer(id: string): Promise<ListingDealerResult | null> {
    return this.db.listing.findFirst({
      where: {
        id,
        status: 'active',
        publicationStatus: 'eligible',
      },
      select: { id: true, dealerProfileId: true },
    })
  }

  findDealerProfile(dealerProfileId: string): Promise<DealerProfileResult | null> {
    return this.db.dealerProfile.findUnique({
      where: { id: dealerProfileId },
      select: {
        id: true,
        name: true,
        zip: true,
        googlePlaceId: true,
        rating: true,
        reviewCount: true,
        hours: true,
        enrichedAt: true,
        reviews: {
          orderBy: [{ rating: 'desc' }, { publishedAt: 'desc' }],
          take: 5,
          select: {
            id: true,
            authorName: true,
            rating: true,
            text: true,
            publishedAt: true,
            source: true,
          },
        },
      },
    })
  }

  findByVin(vin: string): Promise<ListingVinRow | null> {
    return this.db.listing.findFirst({
      where: {
        vin,
        status: 'active',
        publicationStatus: 'eligible',
      },
      select: { id: true, conversionManufacturer: true },
    })
  }

  findListingsByVin(vin: string, activeOnly: boolean): Promise<VinListingRow[]> {
    return this.db.listing.findMany({
      where: {
        vin,
        publicationStatus: 'eligible',
        ...(activeOnly ? { status: 'active' } : {}),
      },
      orderBy: { listedAt: 'desc' },
      select: {
        id: true,
        sourceUrl: true,
        dealerName: true,
        priceCents: true,
        mileage: true,
        status: true,
        listedAt: true,
        goneAt: true,
        soldAt: true,
      },
    })
  }

  async findHistoryByVin(vin: string): Promise<VinHistoryRow[]> {
    const matching = await this.db.listing.findMany({
      where: { vin, publicationStatus: 'eligible' },
      select: { id: true },
    })
    const listingIds = matching.map((l) => l.id)
    if (listingIds.length === 0) return []

    // Unbounded by design: a VIN's re-listing count and history depth are
    // both small in practice (a handful of dealers over a few scrape cycles),
    // unlike make/model-scoped queries. Revisit with a cap/pagination if this
    // becomes a hot endpoint for VINs with unusually long observation history.
    const [priceRows, mileageRows] = await Promise.all([
      this.db.listingPriceHistory.findMany({
        where: { listingId: { in: listingIds } },
        select: { listingId: true, priceCents: true, recordedAt: true },
      }),
      this.db.listingMileageHistory.findMany({
        where: { listingId: { in: listingIds } },
        select: { listingId: true, mileage: true, recordedAt: true },
      }),
    ])

    const merged: VinHistoryRow[] = [
      ...priceRows.map((r) => ({ listingId: r.listingId, type: 'price' as const, value: r.priceCents, recordedAt: r.recordedAt })),
      ...mileageRows.map((r) => ({ listingId: r.listingId, type: 'mileage' as const, value: r.mileage, recordedAt: r.recordedAt })),
    ]
    merged.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    return merged
  }

  findVehicleModelWithSafetyData(vehicleModelId: string): Promise<VehicleModelWithSafetyData | null> {
    return this.db.vehicleModel.findUnique({
      where: { id: vehicleModelId },
      include: {
        recalls: { orderBy: { reportedAt: 'desc' }, select: { id: true, nhtsaCampaignId: true, component: true, summary: true, remedy: true, reportedAt: true } },
        complaints: { orderBy: { reportedAt: 'desc' }, select: { id: true, nhtsaId: true, component: true, summary: true, mileage: true, crashInvolved: true, reportedAt: true } },
        safetyRatings: { select: { id: true, nhtsaVehicleId: true, description: true, overallRating: true, frontCrashRating: true, sideCrashRating: true, rolloverRating: true, rolloverRatingText: true, refreshedAt: true } },
        investigations: { orderBy: { openedDate: 'desc' }, select: { id: true, nhtsaId: true, component: true, summary: true, openedDate: true, closedDate: true, outcome: true, sourceUrl: true, refreshedAt: true } },
        manufacturerCommunications: { orderBy: { issuedDate: 'desc' }, select: { id: true, nhtsaId: true, component: true, summary: true, issuedDate: true, sourceUrl: true, refreshedAt: true } },
      },
    }) as Promise<VehicleModelWithSafetyData | null>
  }

  findManyActive(skip: number, take: number): Promise<Listing[]> {
    return this.db.$queryRaw<Listing[]>`
      WITH representative_listings AS (
        SELECT DISTINCT ON (COALESCE("vehicleId", id)) *
        FROM listings
        WHERE status = 'active'
          AND "publicationStatus" = 'eligible'
        ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
      )
      SELECT *
      FROM representative_listings
      ORDER BY "listedAt" DESC, id ASC
      LIMIT ${take}
      OFFSET ${skip}
    `
  }

  countObservedActive(): Promise<number> {
    return this.db.listing.count({ where: { status: 'active' } })
  }

  async countActive(): Promise<number> {
    const rows = await this.db.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT COALESCE("vehicleId", id))::int AS count
      FROM listings
      WHERE status = 'active'
        AND "publicationStatus" = 'eligible'
    `
    return Number(rows[0]?.count ?? 0)
  }

  countActiveWithCoordinates(): Promise<number> {
    return this.db.listing.count({
      where: {
        status: 'active',
        lat: { not: null },
        lng: { not: null },
      },
    })
  }

  countActiveMissingCoordinates(): Promise<number> {
    return this.db.listing.count({
      where: {
        status: 'active',
        OR: [
          { lat: null },
          { lng: null },
        ],
      },
    })
  }

  async getPublicationCountsBySource(): Promise<ListingPublicationCountRow[]> {
    const rows = await this.db.$queryRaw<PublicationCountQueryRow[]>`
      SELECT
        "sourceId",
        COUNT(*)::int AS "observedActive",
        COUNT(*) FILTER (WHERE "publicationStatus" = 'eligible')::int AS "eligibleActive",
        (
          SELECT COUNT(*)::int
          FROM listings l2
          WHERE l2."sourceId" = listings."sourceId"
            AND l2.status = 'possibly_gone'
        ) AS "possiblyGoneCount"
      FROM listings
      WHERE status = 'active'
      GROUP BY "sourceId"
    `
    return rows.map(row => ({
      sourceId: row.sourceId,
      observedActive: Number(row.observedActive),
      eligibleActive: Number(row.eligibleActive),
      possiblyGoneCount: Number(row.possiblyGoneCount),
    }))
  }

  findPriceHistory(listingId: string): Promise<PriceHistoryRow[]> {
    return this.db.listingPriceHistory.findMany({
      where: { listingId },
      orderBy: { recordedAt: 'asc' },
      select: { id: true, priceCents: true, recordedAt: true },
    })
  }

  private quarantineWhere(filter: Omit<QuarantineFilter, 'skip' | 'take'>): Prisma.ListingWhereInput {
    const ruleCondition = filter.rule == null
      ? {}
      : Array.isArray(filter.rule)
        ? { qualityIssueCodes: { hasSome: filter.rule } }
        : { qualityIssueCodes: { has: filter.rule } }

    return {
      publicationStatus: 'quarantined',
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
      ...ruleCondition,
      ...(filter.olderThanMs != null
        ? {
            OR: [
              { qualityCheckedAt: { lte: new Date(Date.now() - filter.olderThanMs) } },
              { AND: [{ qualityCheckedAt: null }, { scrapedAt: { lte: new Date(Date.now() - filter.olderThanMs) } }] },
            ],
          }
        : {}),
    }
  }

  async findQuarantined(filter: QuarantineFilter): Promise<QuarantinedListingRow[]> {
    const rows = await this.db.listing.findMany({
      where: this.quarantineWhere(filter),
      orderBy: { qualityCheckedAt: 'desc' },
      skip: filter.skip ?? 0,
      take: filter.take ?? 50,
      select: {
        id: true,
        sourceId: true,
        sourceUrl: true,
        sourceRecordKey: true,
        make: true,
        model: true,
        year: true,
        qualityIssueCodes: true,
        qualityCheckedAt: true,
        scrapedAt: true,
        updatedAt: true,
        source: { select: { name: true } },
        // Latest observation only — gives the extractor version that produced
        // the current (quarantined) field values, needed for repair.
        observations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
          select: { extractionVersion: true },
        },
      },
    })
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.name,
      sourceUrl: row.sourceUrl,
      sourceRecordKey: row.sourceRecordKey,
      make: row.make,
      model: row.model,
      year: row.year,
      qualityIssueCodes: row.qualityIssueCodes,
      qualityCheckedAt: row.qualityCheckedAt,
      scrapedAt: row.scrapedAt,
      updatedAt: row.updatedAt,
      extractionVersion: row.observations[0]?.extractionVersion ?? null,
    }))
  }

  countQuarantined(filter: Omit<QuarantineFilter, 'skip' | 'take'>): Promise<number> {
    return this.db.listing.count({ where: this.quarantineWhere(filter) })
  }

  async reprocessQuarantined(id: string): Promise<boolean> {
    const result = await this.db.listing.updateMany({
      where: { id, publicationStatus: 'quarantined' },
      data: {
        publicationStatus: 'pending',
        qualityIssueCodes: [],
        qualityCheckedAt: null,
      },
    })
    return result.count > 0
  }

  private fieldConflictWhere(filter: Omit<FieldConflictFilter, 'skip' | 'take'>): Prisma.ListingWhereInput {
    const wantsConversion = !filter.field || filter.field === 'conversionType'
    const wantsRamp = !filter.field || filter.field === 'rampType'
    return {
      status: 'active',
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
      OR: [
        ...(wantsConversion ? [{ conversionTypeResolution: 'conflicting' as const }] : []),
        ...(wantsRamp ? [{ rampTypeResolution: 'conflicting' as const }] : []),
      ],
    }
  }

  async findFieldConflicts(filter: FieldConflictFilter): Promise<FieldConflictRow[]> {
    const listingRows = await this.db.listing.findMany({
      where: this.fieldConflictWhere(filter),
      orderBy: { updatedAt: 'desc' },
      skip: filter.skip ?? 0,
      take: filter.take ?? 50,
      select: {
        id: true,
        sourceUrl: true,
        make: true,
        model: true,
        year: true,
        conversionTypeResolution: true,
        rampTypeResolution: true,
        updatedAt: true,
      },
    })
    if (listingRows.length === 0) return []

    const claims = await this.db.listingFieldClaim.findMany({
      where: { listingId: { in: listingRows.map((l) => l.id) }, eligible: true },
      orderBy: { observedAt: 'desc' },
    })
    const claimsByListingField = new Map<string, typeof claims>()
    for (const claim of claims) {
      const key = `${claim.listingId}:${claim.field}`
      const group = claimsByListingField.get(key)
      if (group) group.push(claim)
      else claimsByListingField.set(key, [claim])
    }

    const rows: FieldConflictRow[] = []
    for (const listing of listingRows) {
      const fields: Array<['conversionType' | 'rampType', 'conflicting' | string]> = [
        ['conversionType', listing.conversionTypeResolution],
        ['rampType', listing.rampTypeResolution],
      ]
      for (const [field, resolution] of fields) {
        if (resolution !== 'conflicting') continue
        if (filter.field && filter.field !== field) continue

        // Latest claim per (evidenceKind, sourceRef) slot — mirrors the
        // resolver's own dedup (apps/scraper/src/resolution/resolver.ts) so
        // this shows exactly the claims currently driving the conflict, not
        // every superseded historical row.
        const latestBySlot = new Map<string, (typeof claims)[number]>()
        for (const claim of claimsByListingField.get(`${listing.id}:${field}`) ?? []) {
          const slotKey = `${claim.evidenceKind} ${claim.sourceRef ?? ''}`
          if (!latestBySlot.has(slotKey)) latestBySlot.set(slotKey, claim)
        }
        const competing = [...latestBySlot.values()]

        rows.push({
          listingId: listing.id,
          sourceUrl: listing.sourceUrl,
          make: listing.make,
          model: listing.model,
          year: listing.year,
          field,
          competingValues: competing.map((c) => c.claimedValue),
          evidenceKinds: competing.map((c) => c.evidenceKind),
          sourceRefs: competing.map((c) => c.sourceRef),
          observedAts: competing.map((c) => c.observedAt),
          detectedAt: listing.updatedAt,
        })
      }
    }
    return rows
  }

  async countFieldConflicts(filter: Omit<FieldConflictFilter, 'skip' | 'take'>): Promise<number> {
    // findFieldConflicts returns one row per (listing, field) — a listing
    // conflicting on both fields yields two rows. Count each field
    // separately and sum, rather than counting listings, so `meta.total`
    // matches the actual row count across pages instead of undercounting.
    const wantsConversion = !filter.field || filter.field === 'conversionType'
    const wantsRamp = !filter.field || filter.field === 'rampType'
    const baseWhere = {
      status: 'active' as const,
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    }
    const [conversionCount, rampCount] = await Promise.all([
      wantsConversion
        ? this.db.listing.count({ where: { ...baseWhere, conversionTypeResolution: 'conflicting' } })
        : Promise.resolve(0),
      wantsRamp
        ? this.db.listing.count({ where: { ...baseWhere, rampTypeResolution: 'conflicting' } })
        : Promise.resolve(0),
    ])
    return conversionCount + rampCount
  }

  async createListingReport(input: CreateListingReportInput): Promise<ListingReportRow> {
    const reportId = randomUUID()
    const notes = input.notes?.trim() || null
    const rows = await this.db.$queryRaw<ListingReportRow[]>`
      INSERT INTO listing_reports (id, "listingId", "reportType", notes)
      VALUES (${reportId}, ${input.listingId}, ${input.reportType}::"ListingReportType", ${notes})
      RETURNING id, "listingId", "reportType", notes, status, "reportedAt"
    `
    return rows[0]!
  }

  async countUnresolvedReports(listingId: string): Promise<number> {
    const rows = await this.db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM listing_reports
      WHERE "listingId" = ${listingId}
        AND status = 'unresolved'::"ListingReportStatus"
    `
    return Number(rows[0]?.count ?? 0)
  }

  async findListingReportTriage(filter: ListingReportTriageFilter): Promise<ListingReportTriageRow[]> {
    const minReports = filter.minReports ?? 1
    const rows = await this.db.$queryRaw<Array<ListingReportTriageRow & { unresolvedCount: number | bigint }>>`
      SELECT
        l.id AS "listingId",
        l."sourceUrl",
        l.make,
        l.model,
        l.year,
        COUNT(r.id)::int AS "unresolvedCount",
        MAX(r."reportedAt") AS "latestReportedAt",
        ARRAY_AGG(DISTINCT r."reportType") AS "reportTypes"
      FROM listings l
      JOIN listing_reports r ON r."listingId" = l.id
      WHERE r.status = 'unresolved'::"ListingReportStatus"
      GROUP BY l.id, l."sourceUrl", l.make, l.model, l.year
      HAVING COUNT(r.id) >= ${minReports}
      ORDER BY COUNT(r.id) DESC, MAX(r."reportedAt") DESC, l.id ASC
      LIMIT ${filter.take ?? 50}
      OFFSET ${filter.skip ?? 0}
    `
    return rows.map((row) => ({ ...row, unresolvedCount: Number(row.unresolvedCount) }))
  }

  async countListingReportTriage(filter: Omit<ListingReportTriageFilter, 'skip' | 'take'>): Promise<number> {
    const minReports = filter.minReports ?? 1
    const rows = await this.db.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT r."listingId"
        FROM listing_reports r
        WHERE r.status = 'unresolved'::"ListingReportStatus"
        GROUP BY r."listingId"
        HAVING COUNT(r.id) >= ${minReports}
      ) grouped_reports
    `
    return Number(rows[0]?.count ?? 0)
  }

  async getSourcePipelineStages(sourceId: string): Promise<SourcePipelineStageRow[]> {
    const staleThreshold = new Date(Date.now() - STALE_DETAIL_CRAWL_DAYS * 24 * 60 * 60 * 1000)

    const [
      pendingDetailCrawl,
      lastDetailCrawlAt,
      pendingDetailExtract,
      lastDetailExtractAt,
      pendingGeocode,
      lastGeocodeAt,
      pendingVinEnrich,
      lastVinEnrichAt,
    ] = await Promise.all([
      this.db.listing.count({
        where: {
          sourceId,
          status: { not: 'gone' },
          OR: [
            { detailScrapedAt: null },
            { detailScrapedAt: { lt: staleThreshold } },
          ],
        },
      }),
      this.db.listing.aggregate({
        where: { sourceId, detailScrapedAt: { not: null } },
        _max: { detailScrapedAt: true },
      }),
      this.db.rawPage.count({ where: { sourceId, processedAt: null } }),
      this.db.rawPage.aggregate({
        where: { sourceId, processedAt: { not: null } },
        _max: { processedAt: true },
      }),
      this.db.listing.count({
        where: {
          sourceId,
          lat: null,
          city: { not: null },
          state: { not: null },
        },
      }),
      this.db.listing.aggregate({
        where: { sourceId, lat: { not: null } },
        _max: { updatedAt: true },
      }),
      this.db.listing.count({
        where: {
          sourceId,
          vin: { not: null },
          vehicleModelId: null,
        },
      }),
      this.db.listing.aggregate({
        where: { sourceId, vin: { not: null }, vehicleModelId: { not: null } },
        _max: { updatedAt: true },
      }),
    ])

    return [
      { stage: 'detail-crawl', pendingCount: pendingDetailCrawl, lastCompletedAt: lastDetailCrawlAt._max.detailScrapedAt },
      { stage: 'detail-extract', pendingCount: pendingDetailExtract, lastCompletedAt: lastDetailExtractAt._max.processedAt },
      { stage: 'geocode', pendingCount: pendingGeocode, lastCompletedAt: lastGeocodeAt._max.updatedAt },
      { stage: 'vin-enrich', pendingCount: pendingVinEnrich, lastCompletedAt: lastVinEnrichAt._max.updatedAt },
    ]
  }
}
