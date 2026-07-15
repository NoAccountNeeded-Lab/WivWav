import { SourceStatus, type PrismaClient, type Prisma } from '@wivwav/db'

// ── Shape types ──────────────────────────────────────────────────────────────

export type DealerProfileRow = {
  id: string
  name: string
  zip: string
  rating: number | null
  reviewCount: number | null
  hours: Prisma.JsonValue | null
}

export type DealerListingStatusFilter = 'active' | 'gone' | 'all'

export type DealerListingRow = {
  id: string
  make: string
  model: string
  year: number
  priceCents: number | null
  mileage: number | null
  status: string
  listedAt: Date
  goneAt: Date | null
  soldAt: Date | null
}

export type DealerReviewRow = {
  id: string
  authorName: string
  rating: number
  text: string
  publishedAt: Date
  source: string
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface DealerRepository {
  findProfile(id: string): Promise<DealerProfileRow | null>
  /**
   * Paginated listings for a dealer. `status: 'active'` is the FREE-tier
   * shape; `'gone'` and `'all'` are PRO-gated in the route layer — see
   * `GET /v1/dealers/:id/listings`.
   */
  findListings(id: string, status: DealerListingStatusFilter, skip: number, take: number): Promise<DealerListingRow[]>
  countListings(id: string, status: DealerListingStatusFilter): Promise<number>
  findReviews(id: string, skip: number, take: number): Promise<DealerReviewRow[]>
  countReviews(id: string): Promise<number>
}

// ── Prisma implementation ────────────────────────────────────────────────────

export class PrismaDealerRepository implements DealerRepository {
  constructor(private readonly db: PrismaClient) {}

  findProfile(id: string): Promise<DealerProfileRow | null> {
    return this.db.dealerProfile.findUnique({
      where: { id },
      select: { id: true, name: true, zip: true, rating: true, reviewCount: true, hours: true },
    })
  }

  findListings(id: string, status: DealerListingStatusFilter, skip: number, take: number): Promise<DealerListingRow[]> {
    return this.db.listing.findMany({
      where: {
        dealerProfileId: id,
        publicationStatus: 'eligible',
        source: { is: { status: { not: SourceStatus.disabled } } },
        ...statusWhere(status),
      },
      orderBy: { listedAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        priceCents: true,
        mileage: true,
        status: true,
        listedAt: true,
        goneAt: true,
        soldAt: true,
      },
    })
  }

  countListings(id: string, status: DealerListingStatusFilter): Promise<number> {
    return this.db.listing.count({
      where: {
        dealerProfileId: id,
        publicationStatus: 'eligible',
        source: { is: { status: { not: SourceStatus.disabled } } },
        ...statusWhere(status),
      },
    })
  }

  findReviews(id: string, skip: number, take: number): Promise<DealerReviewRow[]> {
    return this.db.dealerReview.findMany({
      where: { dealerId: id },
      orderBy: [{ publishedAt: 'desc' }],
      skip,
      take,
      select: { id: true, authorName: true, rating: true, text: true, publishedAt: true, source: true },
    })
  }

  countReviews(id: string): Promise<number> {
    return this.db.dealerReview.count({ where: { dealerId: id } })
  }
}

function statusWhere(status: DealerListingStatusFilter): Prisma.ListingWhereInput {
  if (status === 'active') return { status: 'active' }
  if (status === 'gone') return { status: 'gone' }
  return {}
}
