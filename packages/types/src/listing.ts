export type QualityIssueSeverity = 'error' | 'warn'

/**
 * Static rule-id → severity map for every qualityIssueCodes entry the
 * publication validator (apps/scraper/src/engine/listing-validator.ts) can
 * emit. Lives here, rather than in the scraper app, so apps/api's operator
 * quarantine endpoints can filter/display by severity without an app-to-app
 * dependency — apps may only depend on packages in this monorepo.
 *
 * The scraper validator is the single source of truth for rule IDs; this map
 * must be kept in sync with every push()/issue call site there. Each rule id
 * has exactly one severity — ambiguous cases (e.g. "missing required field"
 * that is sometimes an error and sometimes a warning) are split into
 * distinct rule ids so this map stays a simple, reliable lookup.
 */
export const QUALITY_RULE_SEVERITY: Readonly<Record<string, QualityIssueSeverity>> = {
  contains_space: 'error',
  field_label_bleed: 'warn',
  contains_digits: 'warn',
  invalid_format: 'warn',
  implausible_year: 'error',
  implausible_value: 'warn',
  negative_value: 'error',
  new_with_high_mileage: 'warn',
  malformed_source_url: 'error',
  unparseable_vin: 'error',
  invalid_check_digit: 'warn',
  missing_identity_field: 'error',
  missing_required_field: 'warn',
  missing_conditional_field: 'warn',
  sold_without_sold_at: 'warn',
  active_with_sold_at: 'error',
  gone_with_full_detail: 'warn',
  unsupported_accessibility_claim: 'warn',
  nhtsa_make_mismatch: 'error',
  nhtsa_model_mismatch: 'error',
  nhtsa_year_mismatch: 'error',
} as const

/*
 * Vocabulary unions are derived from `as const` tuples (like WAV_FEATURES
 * below) so the wire schemas in scraper-gateway.ts can build their z.enum()
 * from the same single source of truth instead of hand-repeating the members.
 */
export const CONVERSION_TYPES = ['rear_entry', 'side_entry', 'unknown'] as const
export type ConversionType = (typeof CONVERSION_TYPES)[number]
export const RAMP_TYPES = ['in_floor', 'fold_out', 'fold_in', 'none', 'unknown'] as const
export type RampType = (typeof RAMP_TYPES)[number]
export const CONVERSION_STATUSES = ['proposed', 'complete', 'unknown'] as const
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number]
export const LISTING_CONDITIONS = ['new', 'used', 'certified_pre_owned'] as const
export type ListingCondition = (typeof LISTING_CONDITIONS)[number]
export const LISTING_SELLER_TYPES = ['dealer', 'private'] as const
export type ListingSellerType = (typeof LISTING_SELLER_TYPES)[number]
export const SALE_STATUSES = ['active', 'pending', 'sold', 'gone'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

/**
 * Controlled vocabulary for WAV features.
 * Keys match the Prisma WavFeature enum. Values are human-readable display labels.
 * Absence of a feature in wavFeatures means "not observed", not "confirmed absent".
 */
export const WAV_FEATURES = {
  hand_controls: 'Hand Controls',
  transfer_seat: 'Transfer Seat',
  has_lift: 'Wheelchair Lift',
  kneel_system: 'Kneel System',
  lowered_floor: 'Lowered Floor',
  power_ramp: 'Power Ramp',
  tie_down_system: 'Tie-Down System',
  automatic_door: 'Automatic Door',
  motorized_running_board: 'Motorized Running Board',
} as const

export type WavFeature = keyof typeof WAV_FEATURES

export interface WavFeatures {
  conversionType: ConversionType
  conversionManufacturer: string | null
  floorLoweringInches: number | null
  rampType: RampType
  conversionStatus: ConversionStatus
  wavFeatures: WavFeature[]
  wheelchairCapacity: number | null
}

/**
 * #499 deterministic resolution status for a claim/evidence-backed field.
 * Distinct from the field's own normalized value (`ConversionType`,
 * `RampType`) — `conflicting` and `unknown` describe how trustworthy the
 * stored value is, never a side/rear/ramp value itself. Mirrors Prisma's
 * `FieldResolutionState` enum (packages/db/prisma/schema.prisma).
 */
export const FIELD_RESOLUTION_STATES = [
  'verified',
  'source_reported',
  'conflicting',
  'unknown',
] as const
export type FieldResolutionState = (typeof FIELD_RESOLUTION_STATES)[number]

export interface WavFieldResolution {
  conversionType: FieldResolutionState
  rampType: FieldResolutionState
}

export interface ListingLocation {
  zip: string | null
  city: string | null
  state: string | null
  lat: number | null
  lng: number | null
}

export interface ListingDealer {
  name: string | null
  phone: string | null
  website: string | null
}

export interface Listing {
  id: string
  sourceId: string
  sourceUrl: string
  buyerUrl: string | null
  externalId: string | null
  stockNumber: string | null
  sourceRecordKey: string

  make: string
  model: string
  year: number
  trim: string | null
  vin: string | null
  condition: ListingCondition
  sellerType: ListingSellerType

  priceCents: number | null
  mileage: number | null
  color: string | null
  fuelType: string | null
  transmission: string | null

  wav: WavFeatures
  /**
   * #499 resolution status for `wav.conversionType`/`wav.rampType`. Optional
   * because ingestion payloads (`ListingUpsertData`) never set it — it is
   * resolver-owned (apps/scraper/src/resolution) and always present on a
   * real API response.
   */
  fieldResolution?: WavFieldResolution
  location: ListingLocation
  dealer: ListingDealer

  images: string[]
  description: string | null

  /**
   * Scrape-time quality issue codes populated by the source adapter.
   * Examples: 'invalid_check_digit' (structurally valid VIN, wrong check digit),
   * 'unparseable_vin' (garbage string). Rule ids match QUALITY_RULE_SEVERITY
   * above and apps/scraper's listing-validator.ts, which re-derives and
   * overwrites these during publication — see decidePublication().
   */
  qualityIssueCodes?: string[]

  saleStatus: SaleStatus
  soldAt: Date | null

  /**
   * When WivWav first observed this source listing. This is an internal
   * discovery timestamp, not a seller-provided publication date.
   */
  listedAt: Date
  /** Seller/source publication timestamp, when explicitly provided. */
  sourceListedAt: Date | null
  /** Seller/source modification timestamp, when explicitly provided. */
  sourceUpdatedAt: Date | null
  updatedAt: Date
  scrapedAt: Date
}

export interface ListingProvenance {
  sourceName: string
  sourceBaseUrl: string
  sourceUrl: string
  buyerUrl: string | null
  scrapedAt: Date
  detailScrapedAt: Date | null
  vehicleModelMatchConfidence: string | null
}

export type ListingDetail = Omit<Listing, 'scrapedAt' | 'sourceId'> & {
  provenance: ListingProvenance
}

export type ListingPreview = Pick<
  Listing,
  | 'id'
  | 'sourceId'
  | 'sourceUrl'
  | 'buyerUrl'
  | 'make'
  | 'model'
  | 'year'
  | 'condition'
  | 'sellerType'
  | 'priceCents'
  | 'mileage'
  | 'location'
  | 'wav'
  | 'images'
  | 'listedAt'
  | 'sourceListedAt'
  | 'sourceUpdatedAt'
>
