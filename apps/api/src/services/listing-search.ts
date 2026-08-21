import type { Meilisearch } from 'meilisearch'
import type { ListingDocument } from '@wivwav/search'
import {
  INDEX_NAME,
  configureIndexSettings,
} from '@wivwav/search'
import type { SearchService, SearchFilters, RangeFilter } from './search/index.js'

export { INDEX_NAME, priceBucket, mileageBucket } from '@wivwav/search'
export type { ListingDocument } from '@wivwav/search'

export interface SearchParams {
  q?: string | undefined
  page?: number | undefined
  perPage?: number | undefined
  make?: string[] | undefined
  model?: string[] | undefined
  trim?: string[] | undefined
  yearMin?: number | undefined
  yearMax?: number | undefined
  priceMin?: number | undefined
  priceMax?: number | undefined
  mileageMax?: number | undefined
  condition?: string[] | undefined
  conversionBrand?: string[] | undefined
  conversionType?: string[] | undefined
  rampType?: string[] | undefined
  wavFeatures?: string[] | undefined
  color?: string[] | undefined
  state?: string[] | undefined
  sellerType?: string[] | undefined
  fuelType?: string[] | undefined
  sort?: string | undefined
}

export interface SearchResult {
  hits: ListingDocument[]
  total: number
  facets: Record<string, Record<string, number>>
}

/**
 * Configure the Meilisearch listings index with required settings.
 * Thin wrapper over the shared `configureIndexSettings` (packages/search) so
 * the scraper's versioned-rebuild path and the API's idempotent startup
 * settings-refresh apply the exact same settings definition.
 *
 * Called on every API startup so filters/facets work on the first request.
 * Idempotent — safe on every restart, including a fresh container. Never
 * clears or rebuilds the live index's documents.
 */
export async function configureListingsIndex(client: Meilisearch, indexName = INDEX_NAME): Promise<void> {
  await configureIndexSettings(client, indexName)
}

/**
 * Translate listing search/facet params into provider-agnostic filter structures.
 * Extracted so `ListingSearchService` and `ListingFacetsService` share the same
 * filter-building logic without duplicating it.
 */
export function buildListingFilters(params: Omit<SearchParams, 'page' | 'perPage' | 'sort'>): {
  filters: SearchFilters
  rangeFilters: RangeFilter[]
} {
  const filters: SearchFilters = {
    status: 'active',
    publicationStatus: 'eligible',
  }
  if (params.make?.length) filters['make'] = params.make
  if (params.model?.length) filters['model'] = params.model
  if (params.trim?.length) filters['trim'] = params.trim
  if (params.condition?.length) filters['condition'] = params.condition
  if (params.conversionBrand?.length) filters['conversionBrand'] = params.conversionBrand
  if (params.conversionType?.length) filters['conversionType'] = params.conversionType
  if (params.rampType?.length) filters['rampType'] = params.rampType
  if (params.wavFeatures?.length) filters['wavFeatures'] = params.wavFeatures
  if (params.color?.length) filters['color'] = params.color
  if (params.state?.length) filters['state'] = params.state
  if (params.sellerType?.length) filters['sellerType'] = params.sellerType
  if (params.fuelType?.length) filters['fuelType'] = params.fuelType

  const rangeFilters: RangeFilter[] = []
  if (params.yearMin != null || params.yearMax != null) {
    rangeFilters.push({
      field: 'year',
      ...(params.yearMin != null ? { gte: params.yearMin } : {}),
      ...(params.yearMax != null ? { lte: params.yearMax } : {}),
    })
  }
  if (params.priceMin != null || params.priceMax != null) {
    rangeFilters.push({
      field: 'priceCents',
      ...(params.priceMin != null ? { gte: params.priceMin } : {}),
      ...(params.priceMax != null ? { lte: params.priceMax } : {}),
    })
  }
  if (params.mileageMax != null) {
    rangeFilters.push({ field: 'mileage', lte: params.mileageMax })
  }

  return { filters, rangeFilters }
}

export class ListingSearchService {
  constructor(private readonly searchService: SearchService) {}

  async search(params: SearchParams): Promise<SearchResult> {
    const page = params.page ?? 1
    const perPage = params.perPage ?? 20

    const { filters, rangeFilters } = buildListingFilters(params)

    const result = await this.searchService.search<ListingDocument>(INDEX_NAME, {
      ...(params.q != null ? { query: params.q } : {}),
      filters,
      ...(rangeFilters.length ? { rangeFilters } : {}),
      facets: ['make', 'model', 'year', 'trim', 'condition', 'conversionType', 'rampType', 'color', 'state', 'sellerType', 'fuelType'],
      ...(params.sort ? { sort: [params.sort] } : {}),
      limit: perPage,
      offset: (page - 1) * perPage,
    })

    return {
      hits: result.hits,
      total: result.total,
      facets: (result.facetDistribution ?? {}) as Record<string, Record<string, number>>,
    }
  }
}

/** @deprecated Use buildFilterString from ./search/meilisearch-service.js for new code. */
export function q(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
