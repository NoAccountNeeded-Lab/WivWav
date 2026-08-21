import type { CacheService } from './cache/index.js'
import type { SearchService } from './search/index.js'
import { INDEX_NAME, buildListingFilters } from './listing-search.js'
import type { SearchParams } from './listing-search.js'

export type FacetsParams = Omit<SearchParams, 'page' | 'perPage' | 'sort'>

export interface FacetsResult {
  total: number
  priceDistribution: Array<{ bucket: string; count: number }>
  yearDistribution: Array<{ year: number; count: number }>
  mileageDistribution: Array<{ bucket: string; count: number }>
  makeBreakdown: Array<{ value: string; count: number }>
  modelBreakdown: Array<{ value: string; count: number }>
  trimBreakdown: Array<{ value: string; count: number }>
  stateBreakdown: Array<{ value: string; count: number }>
  conditionBreakdown: Array<{ value: string; count: number }>
  conversionBreakdown: Array<{ value: string; count: number }>
  colorBreakdown: Array<{ value: string; count: number }>
  rampTypeBreakdown: Array<{ value: string; count: number }>
  sellerTypeBreakdown: Array<{ value: string; count: number }>
  fuelTypeBreakdown: Array<{ value: string; count: number }>
  /** Counts per conversion brand slug (e.g. `braunability`). */
  conversionBrandBreakdown: Array<{ value: string; count: number }>
  /** Counts per WavFeature key. Keyed by WavFeature enum value. */
  wavFeatureCounts: Record<string, number>
}

const CACHE_TTL_SECONDS = 60
const CACHE_NAMESPACE = 'facets:eligible-v2'

export class ListingFacetsService {
  constructor(
    private readonly searchService: SearchService,
    private readonly cache: CacheService,
  ) {}

  async getFacets(params: FacetsParams): Promise<FacetsResult> {
    // Namespace includes the publication policy so pre-gate cached facet
    // counts cannot survive a deployment of the default-deny boundary.
    const cacheKey = `${CACHE_NAMESPACE}:${stableKey(params)}`

    const cached = await this.cache.get(cacheKey).catch(() => null)
    if (cached) return JSON.parse(cached) as FacetsResult

    const { filters, rangeFilters } = buildListingFilters(params)

    const result = await this.searchService.search(INDEX_NAME, {
      ...(params.q != null ? { query: params.q } : {}),
      filters,
      ...(rangeFilters.length ? { rangeFilters } : {}),
      facets: [
        'make', 'model', 'trim', 'year', 'condition', 'conversionType',
        'rampType', 'wavFeatures', 'color', 'state', 'sellerType', 'fuelType',
        'conversionBrand', 'priceBucket', 'mileageBucket',
      ],
      limit: 0,
    })

    const dist = (result.facetDistribution ?? {}) as Record<string, Record<string, number>>

    const facetsResult: FacetsResult = {
      total: result.total,
      priceDistribution: toSortedBuckets(dist['priceBucket'] ?? {}),
      yearDistribution: toYearDist(dist['year'] ?? {}),
      mileageDistribution: toSortedBuckets(dist['mileageBucket'] ?? {}),
      makeBreakdown: toValueCount(dist['make'] ?? {}),
      modelBreakdown: toValueCount(dist['model'] ?? {}),
      trimBreakdown: toValueCount(dist['trim'] ?? {}),
      stateBreakdown: toValueCount(dist['state'] ?? {}),
      conditionBreakdown: toValueCount(dist['condition'] ?? {}),
      conversionBreakdown: toValueCount(dist['conversionType'] ?? {}),
      colorBreakdown: toValueCount(dist['color'] ?? {}),
      rampTypeBreakdown: toValueCount(dist['rampType'] ?? {}),
      sellerTypeBreakdown: toValueCount(dist['sellerType'] ?? {}),
      fuelTypeBreakdown: toValueCount(dist['fuelType'] ?? {}),
      conversionBrandBreakdown: toValueCount(dist['conversionBrand'] ?? {}),
      wavFeatureCounts: dist['wavFeatures'] ?? {},
    }

    await this.cache
      .set(cacheKey, JSON.stringify(facetsResult), CACHE_TTL_SECONDS)
      .catch(() => {})

    return facetsResult
  }
}

// Sort keys and array values so property insertion order doesn't affect the cache key.
function stableKey(params: FacetsParams): string {
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(params).sort()) {
    const v = (params as Record<string, unknown>)[k]
    sorted[k] = Array.isArray(v) ? [...v].sort() : v
  }
  return JSON.stringify(sorted)
}

function toValueCount(dist: Record<string, number>): Array<{ value: string; count: number }> {
  return Object.entries(dist)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

function toYearDist(dist: Record<string, number>): Array<{ year: number; count: number }> {
  return Object.entries(dist)
    .map(([year, count]) => ({ year: parseInt(year, 10), count }))
    .sort((a, b) => a.year - b.year)
}

// Buckets are stored as "lo-hi" strings. Sort by numeric lo value.
function toSortedBuckets(dist: Record<string, number>): Array<{ bucket: string; count: number }> {
  return Object.entries(dist)
    .map(([bucket, count]) => ({ bucket, count, lo: parseInt(bucket.split('-')[0] ?? '0', 10) }))
    .sort((a, b) => a.lo - b.lo)
    .map(({ bucket, count }) => ({ bucket, count }))
}
