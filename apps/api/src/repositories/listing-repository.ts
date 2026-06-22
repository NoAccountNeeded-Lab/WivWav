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

type CountRow = {
  count: number | bigint
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
  countActive(): Promise<number>
  countActiveWithCoordinates(): Promise<number>
  countActiveMissingCoordinates(): Promise<number>
  findPriceHistory(listingId: string): Promise<PriceHistoryRow[]>
  /** Cursor-based page for bulk sync operations. Returns listings in id order. */
  findPageForSync(take: number, afterId?: string): Promise<Listing[]>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaListingRepository implements ListingRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<ListingWithSource | null> {
    return this.db.listing.findUnique({
      where: { id },
      include: { source: { select: { name: true, baseUrl: true } } },
    })
  }

  findCrossListingsByVehicleId(vehicleId: string, excludeListingId: string): Promise<CrossListingRow[]> {
    return this.db.listing.findMany({
      where: {
        vehicleId,
        status: 'active',
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
    return this.db.listing.findUnique({
      where: { id },
      select: { id: true, vehicleModelId: true },
    })
  }

  findByIdForDealer(id: string): Promise<ListingDealerResult | null> {
    return this.db.listing.findUnique({
      where: { id },
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
      where: { vin },
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
        ORDER BY COALESCE("vehicleId", id), "listedAt" DESC, id ASC
      )
      SELECT *
      FROM representative_listings
      ORDER BY "listedAt" DESC, id ASC
      LIMIT ${take}
      OFFSET ${skip}
    `
  }

  async countActive(): Promise<number> {
    const rows = await this.db.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT COALESCE("vehicleId", id))::int AS count
      FROM listings
      WHERE status = 'active'
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
      orderBy: { id: 'asc' },
    })
  }
}
