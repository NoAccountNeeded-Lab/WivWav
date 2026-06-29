import { describe, it, expect, vi } from 'vitest'
import { MeilisearchService, buildFilterString } from './meilisearch-service.js'
import type { SearchOptions } from './types.js'

// ---------------------------------------------------------------------------
// buildFilterString — filter expression construction
// ---------------------------------------------------------------------------

describe('buildFilterString', () => {
  it('returns undefined when no filters are provided', () => {
    expect(buildFilterString()).toBeUndefined()
    expect(buildFilterString({}, [])).toBeUndefined()
  })

  it('builds an equality filter for a string value', () => {
    const result = buildFilterString({ status: 'active' })
    expect(result).toBe('status = "active"')
  })

  it('builds an IN filter for a string array', () => {
    const result = buildFilterString({ make: ['Toyota', 'Ford'] })
    expect(result).toBe('make IN ["Toyota", "Ford"]')
  })

  it('builds a boolean filter for true', () => {
    expect(buildFilterString({ hasLift: true })).toBe('hasLift = true')
  })

  it('builds a boolean filter for false', () => {
    expect(buildFilterString({ hasLift: false })).toBe('hasLift = false')
  })

  it('skips undefined values', () => {
    const result = buildFilterString({ status: 'active', make: undefined })
    expect(result).toBe('status = "active"')
  })

  it('skips empty array values', () => {
    const result = buildFilterString({ status: 'active', make: [] })
    expect(result).toBe('status = "active"')
  })

  it('escapes double quotes in string values', () => {
    const result = buildFilterString({ make: 'say "hello"' })
    expect(result).toBe('make = "say \\"hello\\""')
  })

  it('escapes backslashes in string values', () => {
    const result = buildFilterString({ path: 'C:\\dir' })
    expect(result).toBe('path = "C:\\\\dir"')
  })

  it('builds a gte range filter', () => {
    const result = buildFilterString({}, [{ field: 'year', gte: 2018 }])
    expect(result).toBe('year >= 2018')
  })

  it('builds a lte range filter', () => {
    const result = buildFilterString({}, [{ field: 'mileage', lte: 50000 }])
    expect(result).toBe('mileage <= 50000')
  })

  it('builds both gte and lte range filters for the same field', () => {
    const result = buildFilterString({}, [{ field: 'year', gte: 2018, lte: 2022 }])
    expect(result).toContain('year >= 2018')
    expect(result).toContain('year <= 2022')
  })

  it('combines equality filters and range filters with AND', () => {
    const result = buildFilterString(
      { status: 'active', make: ['Toyota'] },
      [{ field: 'year', gte: 2020 }],
    )
    expect(result).toContain('status = "active"')
    expect(result).toContain('make IN ["Toyota"]')
    expect(result).toContain('year >= 2020')
    const parts = result!.split(' AND ')
    expect(parts.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// MeilisearchService — thin adapter over the Meilisearch client
// ---------------------------------------------------------------------------

function makeClient() {
  const searchMock = vi.fn(async (_query: string, _opts: Record<string, unknown>) => ({
    hits: [] as Record<string, unknown>[],
    estimatedTotalHits: 0 as number | undefined,
    facetDistribution: {} as Record<string, Record<string, number>> | undefined,
  }))
  const addDocumentsMock = vi.fn(async (_docs: unknown, _opts: unknown) => ({}))
  const deleteDocumentsMock = vi.fn(async (_ids: unknown) => ({}))
  const deleteAllDocumentsMock = vi.fn(async () => ({ taskUid: 9 }))
  const waitForTaskMock = vi.fn(async () => ({ status: 'succeeded', uid: 9 }))
  const indexMock = vi.fn(() => ({
    search: searchMock,
    addDocuments: addDocumentsMock,
    deleteDocuments: deleteDocumentsMock,
    deleteAllDocuments: deleteAllDocumentsMock,
  }))
  const client = { index: indexMock, tasks: { waitForTask: waitForTaskMock } }
  return {
    client,
    searchMock,
    addDocumentsMock,
    deleteDocumentsMock,
    deleteAllDocumentsMock,
    waitForTaskMock,
    indexMock,
  }
}

describe('MeilisearchService.search', () => {
  it('passes the index name to client.index()', async () => {
    const { client, indexMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', {})
    expect(indexMock).toHaveBeenCalledWith('listings')
  })

  it('passes empty string query when query is undefined', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', {})
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![0]).toBe('')
  })

  it('passes the query string through', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', { query: 'wheelchair van' })
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![0]).toBe('wheelchair van')
  })

  it('passes built filter string when filters are provided', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    const options: SearchOptions = { filters: { status: 'active', make: ['Toyota'] } }
    await svc.search('listings', options)
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    const opts = call![1]
    expect(opts?.['filter']).toContain('status = "active"')
    expect(opts?.['filter']).toContain('make IN ["Toyota"]')
  })

  it('omits filter key when no filters are given', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', {})
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    const opts = call![1]
    expect(opts?.['filter']).toBeUndefined()
  })

  it('passes facets when provided', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', { facets: ['make', 'model'] })
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![1]?.['facets']).toEqual(['make', 'model'])
  })

  it('passes sort when provided', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', { sort: ['priceCents:asc'] })
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![1]?.['sort']).toEqual(['priceCents:asc'])
  })

  it('uses default limit of 20 when not specified', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', {})
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![1]?.['limit']).toBe(20)
  })

  it('uses provided limit and offset', async () => {
    const { client, searchMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.search('listings', { limit: 10, offset: 30 })
    const call = searchMock.mock.calls[0]
    expect(call).toBeDefined()
    expect(call![1]?.['limit']).toBe(10)
    expect(call![1]?.['offset']).toBe(30)
  })

  it('maps estimatedTotalHits to total', async () => {
    const { client, searchMock } = makeClient()
    searchMock.mockResolvedValueOnce({ hits: [], estimatedTotalHits: 123, facetDistribution: {} })
    const svc = new MeilisearchService(client as never)
    const result = await svc.search('listings', {})
    expect(result.total).toBe(123)
  })

  it('returns total 0 when estimatedTotalHits is undefined', async () => {
    const { client, searchMock } = makeClient()
    searchMock.mockResolvedValueOnce({ hits: [], estimatedTotalHits: undefined, facetDistribution: {} })
    const svc = new MeilisearchService(client as never)
    const result = await svc.search('listings', {})
    expect(result.total).toBe(0)
  })

  it('returns facetDistribution from the backend response', async () => {
    const { client, searchMock } = makeClient()
    searchMock.mockResolvedValueOnce({
      hits: [],
      estimatedTotalHits: 0,
      facetDistribution: { make: { Toyota: 5 } },
    })
    const svc = new MeilisearchService(client as never)
    const result = await svc.search('listings', {})
    expect(result.facetDistribution).toEqual({ make: { Toyota: 5 } })
  })
})

describe('MeilisearchService.upsert', () => {
  it('calls addDocuments with the provided documents and primaryKey=id', async () => {
    const { client, addDocumentsMock, indexMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    const docs = [{ id: '1', name: 'Test' }]
    await svc.upsert('listings', docs)
    expect(indexMock).toHaveBeenCalledWith('listings')
    expect(addDocumentsMock).toHaveBeenCalledWith(docs, { primaryKey: 'id' })
  })

  it('skips addDocuments when documents array is empty', async () => {
    const { client, addDocumentsMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.upsert('listings', [])
    expect(addDocumentsMock).not.toHaveBeenCalled()
  })
})

describe('MeilisearchService.delete', () => {
  it('calls deleteDocuments with the provided ids', async () => {
    const { client, deleteDocumentsMock, indexMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.delete('listings', ['id-1', 'id-2'])
    expect(indexMock).toHaveBeenCalledWith('listings')
    expect(deleteDocumentsMock).toHaveBeenCalledWith(['id-1', 'id-2'])
  })

  it('skips deleteDocuments when ids array is empty', async () => {
    const { client, deleteDocumentsMock } = makeClient()
    const svc = new MeilisearchService(client as never)
    await svc.delete('listings', [])
    expect(deleteDocumentsMock).not.toHaveBeenCalled()
  })
})

describe('MeilisearchService.clear', () => {
  it('waits for deleteAllDocuments to succeed', async () => {
    const { client, deleteAllDocumentsMock, waitForTaskMock } = makeClient()
    const svc = new MeilisearchService(client as never)

    await svc.clear('listings')

    expect(deleteAllDocumentsMock).toHaveBeenCalledOnce()
    expect(waitForTaskMock).toHaveBeenCalledWith(9, { timeout: 15_000 })
  })

  it('throws when the clear task does not succeed', async () => {
    const { client, waitForTaskMock } = makeClient()
    waitForTaskMock.mockResolvedValueOnce({ status: 'failed', uid: 9 })
    const svc = new MeilisearchService(client as never)

    await expect(svc.clear('listings')).rejects.toThrow(
      'Meilisearch clear failed: task 9 ended with status failed',
    )
  })
})
