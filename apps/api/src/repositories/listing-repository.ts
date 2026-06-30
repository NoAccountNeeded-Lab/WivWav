import type { PrismaClient, Listing, Prisma } from '@wivwav/db'

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

type CountRow = {
  count: number | bigint
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
  findVehicleModelWithSafetyData(vehicleModelId: string): Promise<VehicleModelWithSafetyData | null>
  findManyActive(skip: number, take: number): Promise<Listing[]>
  countObservedActive(): Promise<number>
  countActive(): Promise<number>
  countActiveWithCoordinates(): Promise<number>
  countActiveMissingCoordinates(): Promise<number>
  getPublicationCountsBySource(): Promise<ListingPublicationCountRow[]>
  findPriceHistory(listingId: string): Promise<PriceHistoryRow[]>
  /** Cursor-based page for bulk sync operations. Returns listings in id order. */
  findPageForSync(take: number, afterId?: string): Promise<Listing[]>
  /** Lists quarantined listings, optionally filtered by source, rule, and age. */
  findQuarantined(filter: QuarantineFilter): Promise<QuarantinedListingRow[]>
  countQuarantined(filter: Omit<QuarantineFilter, 'skip' | 'take'>): Promise<number>
  /**
   * Resets a quarantined listing to 'pending' so the next validator pass
   * re-evaluates it (e.g. after an operator corrects upstream data or a
   * source fix ships). Returns false if the listing was not quarantined.
   */
  reprocessQuarantined(id: string): Promise<boolean>
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

  findPageForSync(take: number, afterId?: string): Promise<Listing[]> {
    return this.db.listing.findMany({
      take,
      ...(afterId ? { skip: 1, cursor: { id: afterId } } : {}),
      where: {
        status: 'active',
        publicationStatus: 'eligible',
      },
      orderBy: { id: 'asc' },
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
}
