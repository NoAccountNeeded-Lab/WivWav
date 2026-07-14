import type { ListingDealer, ListingLocation, WavFeatures, WavFieldResolution } from '@wivwav/types'

export type { ListingDealer, ListingLocation, WavFeatures, WavFieldResolution }

export interface ListingProvenance {
  sourceName: string
  sourceBaseUrl: string
  sourceUrl: string
  buyerUrl: string | null
  scrapedAt: string
  detailScrapedAt: string | null
  /** Reserved for future UI use — not currently rendered. */
  vehicleModelMatchConfidence: string | null
}

export interface ListingDetail {
  id: string
  sourceUrl: string
  buyerUrl: string | null
  make: string
  model: string
  year: number
  trim: string | null
  vin: string | null
  condition: string
  sellerType: string
  priceCents: number | null
  mileage: number | null
  color: string | null
  fuelType: string | null
  engine: string | null
  transmission: string | null
  stockNumber: string | null
  wav: WavFeatures
  /** #499 resolution status for wav.conversionType/wav.rampType. */
  fieldResolution?: WavFieldResolution
  location: ListingLocation
  dealer: ListingDealer
  images: string[]
  description: string | null
  listedAt: string
  updatedAt: string
  /** May be null when the source join is unavailable; components must handle gracefully. */
  provenance: ListingProvenance | null
  crossListings: CrossListing[]
}

export interface CrossListing {
  id: string
  sourceUrl: string
  buyerUrl: string | null
  sellerType: string
  priceCents: number | null
  location: Pick<ListingLocation, 'zip' | 'city' | 'state'>
  dealer: ListingDealer
}

export interface PricePoint {
  id: string
  priceCents: number
  recordedAt: string
}

export interface Recall {
  id: string
  nhtsaCampaignId: string
  component: string
  summary: string
  remedy: string | null
  reportedAt: string
  /** Normalized recall status: 'open', 'remedied', or 'unknown' when remedy text cannot be determined. */
  status: 'open' | 'remedied' | 'unknown'
}

export interface SafetyRating {
  id: string
  overallRating: number | null
  frontCrashRating: number | null
  sideCrashRating: number | null
  rolloverRating: number | null
  rolloverRatingText: string | null
  description: string | null
  /** ISO-8601 date of last NHTSA data refresh, or null when unavailable. */
  refreshedAt: string | null
}

export interface Investigation {
  id: string
  nhtsaId: string
  component: string
  summary: string
  openedDate: string
  closedDate: string | null
  outcome: string | null
  /** Direct link to NHTSA record. Source-backed. */
  sourceUrl: string
  refreshedAt: string
}

export interface ManufacturerCommunication {
  id: string
  nhtsaId: string
  component: string
  summary: string
  issuedDate: string
  /** Direct link to NHTSA TSB record. Source-backed. */
  sourceUrl: string
  refreshedAt: string
}

export interface SafetyData {
  vehicleModel: {
    id: string
    make: string
    model: string
    year: number
    trim: string | null
    bodyType: string | null
  } | null
  recalls: Recall[]
  complaints: {
    id: string
    nhtsaId: string
    component: string
    summary: string
    mileage: number | null
    crashInvolved: boolean
    reportedAt: string
  }[]
  safetyRatings: SafetyRating[]
  /** ISO-8601 date from the most recent NHTSA safety rating refresh, or null when unavailable. */
  safetyFreshnessDate: string | null
  investigations: Investigation[]
  manufacturerCommunications: ManufacturerCommunication[]
}

export interface MarketPricing {
  count: number
  priceCents: {
    p10: number
    p25: number
    p50: number
    p75: number
    p90: number
  } | null
  medianDaysListed: number | null
  priceDropRate: number | null
}

export interface SimilarListing {
  id: string
  make: string
  model: string
  year: number
  priceCents: number | null
  mileage: number | null
  city: string | null
  state: string | null
  condition: string
  rampType: string
  conversionManufacturer: string | null
  listedAt: string
}

export interface ModelResearchSource {
  id: string
  sourceName: string
  sourceUrl: string
  fetchedAt: string
}

export interface ModelResearchClaim {
  id: string
  field: string
  claimText: string
  confidence: string
  sourceId: string | null
}

export interface ModelResearch {
  vehicleModel: { id: string; make: string; model: string; year: number }
  researchVersion: number
  researchedAt: string
  sources: ModelResearchSource[]
  claims: ModelResearchClaim[]
}

export interface VehicleStatsSource {
  name: string
  url: string
}

export interface VehicleStats {
  make: string
  model: string
  year: number | null
  avgLifespanMiles: number | null
  reliabilityScore: number | null
  reliabilitySource: string | null
  jdPowerScore: number | null
  methodology: string | null
  refreshedAt: string | null
  sources: VehicleStatsSource[]
}

export interface ModelMsrpSource {
  name: string
  url: string
  fetchedAt: string
}

export interface ModelMsrp {
  vehicleModel: { id: string; make: string; model: string; year: number }
  originalMsrpCents: number | null
  destinationFeeCents: number | null
  currency: string
  source: ModelMsrpSource
}

export interface NmeaDealer {
  id: string
  name: string
  city: string | null
  state: string | null
  phone: string | null
  website: string | null
  qapCertified: boolean
  distanceMiles: number | null
}
