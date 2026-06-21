export type ConversionType = 'rear_entry' | 'side_entry' | 'unknown'
export type RampType = 'in_floor' | 'fold_out' | 'fold_in' | 'none' | 'unknown'
export type ConversionStatus = 'proposed' | 'complete' | 'unknown'
export type ListingCondition = 'new' | 'used' | 'certified_pre_owned'
export type ListingSellerType = 'dealer' | 'private'
export type SaleStatus = 'active' | 'pending' | 'sold'

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
