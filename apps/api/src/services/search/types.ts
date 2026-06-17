/**
 * SearchService — provider-agnostic search abstraction.
 *
 * The concrete implementation shipped with this codebase is MeilisearchService.
 * Alternative implementations can be swapped in without touching callers:
 *
 *   - OpenSearch / Elasticsearch: map SearchOptions to Query DSL
 *   - Algolia: map SearchOptions to Algolia SearchParams
 *   - Typesense: map SearchOptions to Typesense SearchParameters
 *   - Postgres full-text: translate filters to WHERE clauses via pg_trgm / tsvector
 *     (suitable for low-volume or offline environments without a search cluster)
 */

/**
 * Equality / set-membership filters.
 * Each key is a document field name; each value is the required value or set.
 * Boolean fields use a literal boolean.
 */
export interface SearchFilters {
  [field: string]: string | string[] | boolean | undefined
}

/**
 * Numeric range constraint on a single field.
 */
export interface RangeFilter {
  field: string
  gte?: number
  lte?: number
}

/**
 * Options accepted by SearchService.search() and SearchService.getFacets().
 */
export interface SearchOptions {
  /** Full-text query string. Empty string or undefined means "match all". */
  query?: string
  /** Equality / IN filters applied as AND conditions. */
  filters?: SearchFilters
  /** Numeric range filters applied as AND conditions. */
  rangeFilters?: RangeFilter[]
  /** Fields for which facet distribution counts are requested. */
  facets?: string[]
  /** Sort expressions in provider-native format (e.g. "priceCents:asc"). */
  sort?: string[]
  /** Maximum number of hits to return. */
  limit?: number
  /** Zero-based offset for pagination. */
  offset?: number
}

/**
 * A single search hit combined with facet distributions and total count.
 */
export interface SearchResult<T> {
  hits: T[]
  total: number
  facets?: Record<string, Array<{ value: string; count: number }>>
  /** Raw facet distribution as returned by the backend (value → count). */
  facetDistribution?: Record<string, Record<string, number>>
}

/**
 * Provider-agnostic search service interface.
 * All methods are scoped to a named index so one service instance can serve
 * multiple indexes.
 */
export interface SearchService {
  /**
   * Execute a search query and return hits with optional facets.
   * Pass limit: 0 to fetch only facet distribution counts without hits.
   */
  search<T>(indexName: string, options: SearchOptions): Promise<SearchResult<T>>

  /**
   * Upsert (add or replace) documents into the index.
   * The primary key field is "id".
   */
  upsert(indexName: string, documents: object[]): Promise<void>

  /**
   * Delete documents from the index by their ids.
   */
  delete(indexName: string, ids: string[]): Promise<void>
}
