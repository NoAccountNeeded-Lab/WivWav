import type { ConversionType, ListingCondition, RampType, WavFeature } from './listing.js'

export interface IntakeRequest {
  description: string
}

export interface IntakeFilters {
  conversionType?: ConversionType
  rampType?: RampType
  wavFeatures?: WavFeature[]
  condition?: ListingCondition
  priceMax?: number
  state?: string
}

export interface IntakeResponse {
  data: {
    filters: IntakeFilters
  }
}
