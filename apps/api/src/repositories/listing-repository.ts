import type { PrismaClient, Listing } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type ListingWithSource = Listing & {
  source: { name: string; baseUrl: string } | null
}

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
}

export type PriceHistoryRow = {
  id: string
  priceCents: number
  recordedAt: Date
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ListingRepository {
  findById(id: string): Promise<ListingWithSource | null>
  findByIdForSafety(id: string): Promise<ListingSafetyResult | null>
  findVehicleModelWithSafetyData(vehicleModelId: string): Promise<VehicleModelWithSafetyData | null>
  findManyActive(skip: number, take: number): Promise<Listing[]>
  countActive(): Promise<number>
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

  findByIdForSafety(id: string): Promise<ListingSafetyResult | null> {
    return this.db.listing.findUnique({
      where: { id },
      select: { id: true, vehicleModelId: true },
    })
  }

  findVehicleModelWithSafetyData(vehicleModelId: string): Promise<VehicleModelWithSafetyData | null> {
    return this.db.vehicleModel.findUnique({
      where: { id: vehicleModelId },
      include: {
        recalls: { orderBy: { reportedAt: 'desc' }, select: { id: true, nhtsaCampaignId: true, component: true, summary: true, remedy: true, reportedAt: true } },
        complaints: { orderBy: { reportedAt: 'desc' }, select: { id: true, nhtsaId: true, component: true, summary: true, mileage: true, crashInvolved: true, reportedAt: true } },
        safetyRatings: { select: { id: true, nhtsaVehicleId: true, description: true, overallRating: true, frontCrashRating: true, sideCrashRating: true, rolloverRating: true, rolloverRatingText: true, refreshedAt: true } },
      },
    }) as Promise<VehicleModelWithSafetyData | null>
  }

  findManyActive(skip: number, take: number): Promise<Listing[]> {
    return this.db.listing.findMany({ skip, take, where: { status: 'active' }, orderBy: { listedAt: 'desc' } })
  }

  countActive(): Promise<number> {
    return this.db.listing.count({ where: { status: 'active' } })
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
