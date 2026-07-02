import type { ConversionType, ListingCondition, ListingSellerType, RampType, WavFeature } from './listing.js'

export interface RangeFilter<T> {
  min: T | null
  max: T | null
}

export interface ListingFilters {
  query: string | null
  makes: string[]
  models: string[]
  years: RangeFilter<number>
  priceCents: RangeFilter<number>
  mileage: RangeFilter<number>
  conditions: ListingCondition[]
  sellerTypes: ListingSellerType[]
  states: string[]
  conversionTypes: ConversionType[]
  conversionManufacturers: string[]
  rampTypes: RampType[]
  wavFeatures: WavFeature[]
  sourceIds: string[]
}

export type ListingSortField = 'price' | 'year' | 'mileage' | 'listedAt'
export type SortDirection = 'asc' | 'desc'

export interface ListingSort {
  field: ListingSortField
  direction: SortDirection
}

export interface PaginationParams {
  page: number
  perPage: number
}

export interface FacetCount {
  value: string
  count: number
}

export interface PriceBucket {
  minCents: number
  maxCents: number
  count: number
}

export interface ListingAggregations {
  total: number
  priceBuckets: PriceBucket[]
  yearCounts: FacetCount[]
  makeCounts: FacetCount[]
  conditionCounts: FacetCount[]
  sellerTypeCounts: FacetCount[]
  conversionTypeCounts: FacetCount[]
  /**
   * State abbreviation + listing count, e.g. `{ value: 'CA', count: 42 }`.
   * The live implementation of this shape is `FacetsResult.stateBreakdown`
   * in `apps/api/src/services/listing-facets.ts`, served from `GET
   * /v1/listings/facets` and rendered by
   * `apps/web/src/components/StateHeatMap.tsx`.
   */
  stateCounts: FacetCount[]
}
