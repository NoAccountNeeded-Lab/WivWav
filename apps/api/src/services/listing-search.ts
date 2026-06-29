import type { Meilisearch } from 'meilisearch'
import type { ListingDocument } from '@wivwav/search'
import {
  INDEX_NAME,
  toDocument,
} from '@wivwav/search'
import type { SearchService, SearchFilters, RangeFilter } from './search/index.js'
import type { ListingRepository } from '../repositories/index.js'

export { INDEX_NAME, priceBucket, mileageBucket } from '@wivwav/search'
export type { ListingDocument } from '@wivwav/search'

export interface SearchParams {
  q?: string | undefined
  page?: number | undefined
  perPage?: number | undefined
  make?: string[] | undefined
  model?: string[] | undefined
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
  sort?: string | undefined
}

export interface SearchResult {
  hits: ListingDocument[]
  total: number
  facets: Record<string, Record<string, number>>
}

const BATCH_SIZE = 1000

/**
 * Configure the Meilisearch listings index with required settings.
 * This function is intentionally Meilisearch-specific because index settings
 * (filterable attributes, sortable attributes, pagination limits) are not
 * part of the generic SearchService interface.
 */
export async function configureListingsIndex(client: Meilisearch): Promise<void> {
  const index = client.index(INDEX_NAME)
  const task = await index.updateSettings({
    filterableAttributes: [
      'make', 'model', 'year', 'condition', 'sellerType',
      'conversionType', 'rampType', 'wavFeatures',
      'conversionBrand', 'color', 'state', 'city', 'sourceId',
      'priceCents', 'priceBucket', 'mileage', 'mileageBucket', 'status', 'saleStatus',
      'publicationStatus', 'vehicleId', 'vehicleGroupKey',
    ],
    sortableAttributes: ['priceCents', 'mileage', 'year', 'listedAt'],
    pagination: { maxTotalHits: 20000 },
    searchableAttributes: [
      'make', 'model', 'trim', 'description',
      'conversionManufacturer', 'city', 'state',
    ],
    distinctAttribute: 'vehicleGroupKey',
  })
  // Wait for Meilisearch to finish applying settings before the server opens.
  // updateSettings only enqueues a task; without this the index may still have
  // stale attributes when the first request arrives after a fresh deployment.
  const result = await client.tasks.waitForTask(task.taskUid, { timeout: 15_000 })
  if (result.status !== 'succeeded') {
    throw new Error(`Meilisearch settings update failed: task ${result.uid} ended with status ${result.status}`)
  }
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
  if (params.condition?.length) filters['condition'] = params.condition
  if (params.conversionBrand?.length) filters['conversionBrand'] = params.conversionBrand
  if (params.conversionType?.length) filters['conversionType'] = params.conversionType
  if (params.rampType?.length) filters['rampType'] = params.rampType
  if (params.wavFeatures?.length) filters['wavFeatures'] = params.wavFeatures
  if (params.color?.length) filters['color'] = params.color
  if (params.state?.length) filters['state'] = params.state

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
      facets: ['make', 'model', 'year', 'condition', 'conversionType', 'rampType', 'color', 'state'],
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

  async syncAll(listings: ListingRepository): Promise<number> {
    await this.searchService.clear(INDEX_NAME)

    let synced = 0
    let cursor: string | undefined

    for (;;) {
      const rows = await listings.findPageForSync(BATCH_SIZE, cursor)
      if (rows.length === 0) break

      await this.searchService.upsert(INDEX_NAME, rows.map(toDocument))
      synced += rows.length
      cursor = rows[rows.length - 1]!.id
      if (rows.length < BATCH_SIZE) break
    }

    return synced
  }
}

/** @deprecated Use buildFilterString from ./search/meilisearch-service.js for new code. */
export function q(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
