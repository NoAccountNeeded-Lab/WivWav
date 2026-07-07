// Response shapes for the historical-data endpoints added in #454: VIN
// history, VIN cross-listings, dealer history, and market trends.

/** Paid API tiers. Mirrors the `ApiKeyTier` enum in `packages/db/prisma/schema.prisma`. */
export type ApiKeyTier = 'FREE' | 'PRO' | 'ENTERPRISE'

export type VinHistoryEntryType = 'price' | 'mileage'

/** One price or mileage observation for a listing matching a VIN, ordered by `recordedAt`. */
export interface VinHistoryEntry {
  listingId: string
  type: VinHistoryEntryType
  /** Cents for `type: 'price'`, odometer reading for `type: 'mileage'`. */
  value: number
  recordedAt: string
}

export interface VinHistoryResponse {
  vin: string
  history: VinHistoryEntry[]
}

/** Summary row for `GET /v1/vin/:vin/listings` — one per listing matching the VIN. */
export interface VinListingSummary {
  id: string
  sourceUrl: string
  dealerName: string | null
  priceCents: number | null
  mileage: number | null
  status: string
  listedAt: string
  goneAt: string | null
  soldAt: string | null
}

export interface VinListingsResponse {
  vin: string
  listings: VinListingSummary[]
}

export interface DealerProfileSummary {
  id: string
  name: string
  zip: string
  rating: number | null
  reviewCount: number | null
  hours: unknown
}

export type DealerListingStatusFilter = 'active' | 'gone' | 'all'

/** Row for `GET /v1/dealers/:id/listings`. */
export interface DealerListingSummary {
  id: string
  make: string
  model: string
  year: number
  priceCents: number | null
  mileage: number | null
  status: string
  listedAt: string
  goneAt: string | null
  soldAt: string | null
}

export interface DealerListingsResponse {
  listings: DealerListingSummary[]
  pagination: {
    skip: number
    take: number
    total: number
  }
}

export interface DealerReviewSummary {
  id: string
  authorName: string
  rating: number
  text: string
  publishedAt: string
  source: string
}

export interface DealerReviewsResponse {
  reviews: DealerReviewSummary[]
  pagination: {
    skip: number
    take: number
    total: number
  }
}

export type MarketTrendInterval = 'week' | 'month'

/** One time bucket for `GET /v1/market/trends`. */
export interface MarketTrendPoint {
  bucketStart: string
  medianPriceCents: number | null
  activeInventoryCount: number
  avgDaysToGone: number | null
}

export interface MarketTrendsResponse {
  make: string
  model: string
  interval: MarketTrendInterval
  points: MarketTrendPoint[]
}
