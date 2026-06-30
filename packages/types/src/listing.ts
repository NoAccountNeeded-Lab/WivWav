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
  invalid_vin: 'warn',
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

export type ConversionType = 'rear_entry' | 'side_entry' | 'unknown'
export type RampType = 'in_floor' | 'fold_out' | 'fold_in' | 'none' | 'unknown'
export type ConversionStatus = 'proposed' | 'complete' | 'unknown'
export type ListingCondition = 'new' | 'used' | 'certified_pre_owned'
export type ListingSellerType = 'dealer' | 'private'
export type SaleStatus = 'active' | 'pending' | 'sold' | 'gone'

/**
 * Controlled vocabulary for WAV features.
 * Keys match the Prisma WavFeature enum. Values are human-readable display labels.
 * Absence of a feature in wavFeatures means "not observed", not "confirmed absent".
 */
export const WAV_FEATURES = {
  hand_controls:           'Hand Controls',
  transfer_seat:           'Transfer Seat',
  has_lift:                'Wheelchair Lift',
  kneel_system:            'Kneel System',
  lowered_floor:           'Lowered Floor',
  power_ramp:              'Power Ramp',
  tie_down_system:         'Tie-Down System',
  automatic_door:          'Automatic Door',
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
  location: ListingLocation
  dealer: ListingDealer

  images: string[]
  description: string | null

  /**
   * Scrape-time quality issue codes populated by the source adapter.
   * Examples: 'invalid_vin' (check-digit failure), 'unparseable_vin' (garbage string).
   * The publication validator uses these to quarantine or flag rows.
   */
  qualityIssueCodes?: string[]

  saleStatus: SaleStatus
  soldAt: Date | null

  listedAt: Date
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
>
