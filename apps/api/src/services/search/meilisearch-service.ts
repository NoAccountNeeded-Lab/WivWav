import type { Meilisearch } from 'meilisearch'
import type { SearchFilters, SearchOptions, SearchResult, SearchService, RangeFilter } from './types.js'

/**
 * Meilisearch implementation of SearchService.
 *
 * Translates provider-agnostic SearchOptions into Meilisearch filter syntax
 * and delegates all I/O to the Meilisearch client.
 */
export class MeilisearchService implements SearchService {
  constructor(private readonly client: Meilisearch) {}

  async search<T>(indexName: string, options: SearchOptions): Promise<SearchResult<T>> {
    // The Meilisearch SDK constrains T to RecordAny, but our interface is
    // deliberately broader. We access hits as unknown and cast to T[].
    const index = this.client.index(indexName)
    const filter = buildFilterString(options.filters, options.rangeFilters)

    const result = await index.search(options.query ?? '', {
      ...(filter ? { filter } : {}),
      ...(options.facets?.length ? { facets: options.facets } : {}),
      ...(options.sort?.length ? { sort: options.sort } : {}),
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })

    return {
      hits: result.hits as unknown as T[],
      total: result.estimatedTotalHits ?? 0,
      facetDistribution: (result.facetDistribution ?? {}) as Record<string, Record<string, number>>,
    }
  }

  async upsert(indexName: string, documents: object[]): Promise<void> {
    if (documents.length === 0) return
    await this.client.index(indexName).addDocuments(documents, { primaryKey: 'id' })
  }

  async delete(indexName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.client.index(indexName).deleteDocuments(ids)
  }
}

/**
 * Build a Meilisearch filter string from generic SearchFilters + RangeFilters.
 * Returns undefined when no filters are specified.
 */
export function buildFilterString(
  filters?: SearchFilters,
  rangeFilters?: RangeFilter[],
): string | undefined {
  const parts: string[] = []

  if (filters) {
    for (const [field, value] of Object.entries(filters)) {
      if (value === undefined) continue
      if (typeof value === 'boolean') {
        parts.push(`${field} = ${value}`)
      } else if (Array.isArray(value)) {
        if (value.length === 0) continue
        parts.push(`${field} IN [${value.map(quoteStr).join(', ')}]`)
      } else {
        parts.push(`${field} = ${quoteStr(value)}`)
      }
    }
  }

  if (rangeFilters) {
    for (const r of rangeFilters) {
      if (r.gte !== undefined) parts.push(`${r.field} >= ${r.gte}`)
      if (r.lte !== undefined) parts.push(`${r.field} <= ${r.lte}`)
    }
  }

  return parts.length > 0 ? parts.join(' AND ') : undefined
}

function quoteStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
