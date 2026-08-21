import { describe, it, expect, vi } from 'vitest'
import { configureListingsIndex, q, priceBucket, mileageBucket, ListingSearchService } from './listing-search.js'
import type { SearchParams } from './listing-search.js'
import type { SearchService, SearchOptions, SearchResult } from './search/index.js'
import type { ListingDocument } from '@wivwav/search'

// ---------------------------------------------------------------------------
// q() — filter value quoting
// ---------------------------------------------------------------------------

describe('q', () => {
  it('wraps a plain value in double quotes', () => {
    expect(q('Toyota')).toBe('"Toyota"')
  })

  it('escapes embedded double quotes', () => {
    expect(q('say "hello"')).toBe('"say \\"hello\\""')
  })

  it('escapes backslashes before double quotes', () => {
    expect(q('C:\\path')).toBe('"C:\\\\path"')
  })

  it('handles an empty string', () => {
    expect(q('')).toBe('""')
  })
})

// ---------------------------------------------------------------------------
// priceBucket — re-exported from @wivwav/search
// ---------------------------------------------------------------------------

describe('priceBucket', () => {
  it('returns null for null price', () => {
    expect(priceBucket(null)).toBeNull()
  })

  it('puts 0 cents in the 0-5000 bucket', () => {
    expect(priceBucket(0)).toBe('0-5000')
  })

  it('puts $4 999.99 in the 0-5000 bucket', () => {
    expect(priceBucket(499999)).toBe('0-5000')
  })

  it('puts exactly $5 000 in the 5000-10000 bucket', () => {
    expect(priceBucket(500000)).toBe('5000-10000')
  })

  it('puts $27 500 in the 25000-30000 bucket', () => {
    expect(priceBucket(2750000)).toBe('25000-30000')
  })

  it('respects a custom bucket size', () => {
    expect(priceBucket(1000000, 10000)).toBe('10000-20000')
  })
})

// ---------------------------------------------------------------------------
// mileageBucket — re-exported from @wivwav/search
// ---------------------------------------------------------------------------

describe('mileageBucket', () => {
  it('returns null for null mileage', () => {
    expect(mileageBucket(null)).toBeNull()
  })

  it('puts 0 miles in the 0-12000 bucket', () => {
    expect(mileageBucket(0)).toBe('0-12000')
  })

  it('puts 11 999 miles in the 0-12000 bucket', () => {
    expect(mileageBucket(11999)).toBe('0-12000')
  })

  it('puts exactly 12 000 miles in the 12000-24000 bucket', () => {
    expect(mileageBucket(12000)).toBe('12000-24000')
  })

  it('puts 87 000 miles in the 84000-96000 bucket', () => {
    expect(mileageBucket(87000)).toBe('84000-96000')
  })
})

// ---------------------------------------------------------------------------
// configureListingsIndex — v0.58 API surface
// ---------------------------------------------------------------------------
//
// The key change in this PR: waitForTask moved from the client root to
// client.tasks, and the option key changed from `timeOutMs` to `timeout`.
// These tests pin both call sites so a regression is immediately visible.

describe('configureListingsIndex', () => {
  function makeClient(overrides: Partial<{ waitForTask: unknown }> = {}) {
    const waitForTask = overrides.waitForTask ?? vi.fn(async () => ({ status: 'succeeded', uid: 42 }))
    const updateSettings = vi.fn(async () => ({ taskUid: 42 }))
    const client = {
      index: vi.fn(() => ({ updateSettings })),
      tasks: { waitForTask },
    }
    return { client, updateSettings, waitForTask: waitForTask as ReturnType<typeof vi.fn> }
  }

  it('calls client.tasks.waitForTask with the task uid returned by updateSettings', async () => {
    const { client, waitForTask } = makeClient()

    await configureListingsIndex(client as never)

    expect(waitForTask).toHaveBeenCalledOnce()
    expect(waitForTask).toHaveBeenCalledWith(42, expect.objectContaining({ timeout: 15_000 }))
  })

  it('configures the provided index name', async () => {
    const { client } = makeClient()

    await configureListingsIndex(client as never, 'listings_prod')

    expect(client.index).toHaveBeenCalledWith('listings_prod')
  })

  it('does NOT call client.waitForTask (old v0.47 API location)', async () => {
    const rootWaitForTask = vi.fn()
    const { client, waitForTask } = makeClient()
    // Attach a root-level waitForTask to detect if old call path is taken
    const clientWithOldApi = { ...client, waitForTask: rootWaitForTask }

    await configureListingsIndex(clientWithOldApi as never)

    expect(rootWaitForTask).not.toHaveBeenCalled()
    expect(waitForTask).toHaveBeenCalledOnce()
  })

  it('uses timeout option key, not timeOutMs', async () => {
    const { client, waitForTask } = makeClient()

    await configureListingsIndex(client as never)

    const [, options] = waitForTask.mock.calls[0]!
    expect(options).toHaveProperty('timeout', 15_000)
    expect(options).not.toHaveProperty('timeOutMs')
  })

  it('passes the correct timeout value of 15 000 ms', async () => {
    const { client, waitForTask } = makeClient()

    await configureListingsIndex(client as never)

    expect(waitForTask).toHaveBeenCalledWith(expect.any(Number), { timeout: 15_000 })
  })

  it('sets vehicleGroupKey as the distinct attribute', async () => {
    const { client, updateSettings } = makeClient()

    await configureListingsIndex(client as never)

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      distinctAttribute: 'vehicleGroupKey',
    }))
  })

  it('includes trim in filterableAttributes', async () => {
    const { client, updateSettings } = makeClient()

    await configureListingsIndex(client as never)

    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      filterableAttributes: expect.arrayContaining(['trim']),
    }))
  })

  it('propagates errors thrown by updateSettings', async () => {
    const err = new Error('Meilisearch unreachable')
    const client = {
      index: vi.fn(() => ({ updateSettings: vi.fn(async () => { throw err }) })),
      tasks: { waitForTask: vi.fn() },
    }

    await expect(configureListingsIndex(client as never)).rejects.toThrow('Meilisearch unreachable')
    expect(client.tasks.waitForTask).not.toHaveBeenCalled()
  })

  it('propagates errors thrown by tasks.waitForTask', async () => {
    const err = new Error('task timed out')
    const { client } = makeClient({ waitForTask: vi.fn(async () => { throw err }) })

    await expect(configureListingsIndex(client as never)).rejects.toThrow('task timed out')
  })

  it('throws when waitForTask resolves with a failed status', async () => {
    const { client } = makeClient({
      waitForTask: vi.fn(async () => ({ status: 'failed', uid: 42 })),
    })

    await expect(configureListingsIndex(client as never)).rejects.toThrow(
      'Meilisearch settings update failed on "listings": task 42 ended with status failed',
    )
  })

  it('throws when waitForTask resolves with a canceled status', async () => {
    const { client } = makeClient({
      waitForTask: vi.fn(async () => ({ status: 'canceled', uid: 42 })),
    })

    await expect(configureListingsIndex(client as never)).rejects.toThrow(
      'Meilisearch settings update failed on "listings": task 42 ended with status canceled',
    )
  })
})

// ---------------------------------------------------------------------------
// ListingSearchService.search() — SearchService-level mock
// ---------------------------------------------------------------------------
//
// ListingSearchService now depends on SearchService, not the Meilisearch client
// directly. Tests mock SearchService.search() and verify that the service
// builds correct SearchOptions (filters, rangeFilters, facets, sort, limit, offset).

function makeEmptySearchResult(): SearchResult<ListingDocument> {
  return {
    hits: [],
    total: 0,
    facetDistribution: {},
  }
}

function makeService() {
  const searchMock = vi.fn(
    async (_indexName: string, _opts: SearchOptions): Promise<SearchResult<ListingDocument>> =>
      makeEmptySearchResult(),
  )
  const mockSearchService: SearchService = {
    // Cast needed: the SearchService interface declares search as generic <T>,
    // but this mock always returns ListingDocument results.
    search: searchMock as SearchService['search'],
    upsert: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  }
  const service = new ListingSearchService(mockSearchService)
  return { service, searchMock, searchService: mockSearchService }
}

describe('ListingSearchService.search', () => {
  it('always includes status = "active" filter', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['status']).toBe('active')
  })

  it('always includes publicationStatus = "eligible" filter', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['publicationStatus']).toBe('eligible')
  })

  it('defaults to page 1 and perPage 20', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.offset).toBe(0)
    expect(opts.limit).toBe(20)
  })

  it('computes offset from page and perPage', async () => {
    const { service, searchMock } = makeService()
    await service.search({ page: 3, perPage: 10 })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.offset).toBe(20)
    expect(opts.limit).toBe(10)
  })

  it('adds make filter when make is provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({ make: ['Toyota', 'Ford'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['make']).toEqual(['Toyota', 'Ford'])
  })

  it('adds trim filter when trim is provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({ trim: ['LX', 'EX'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['trim']).toEqual(['LX', 'EX'])
  })

  it('adds yearMin and yearMax as range filters', async () => {
    const { service, searchMock } = makeService()
    await service.search({ yearMin: 2018, yearMax: 2022 })
    const [, opts] = searchMock.mock.calls[0]!
    const yearRange = opts.rangeFilters?.find(r => r.field === 'year')
    expect(yearRange).toEqual({ field: 'year', gte: 2018, lte: 2022 })
  })

  it('adds only yearMin when yearMax is absent', async () => {
    const { service, searchMock } = makeService()
    await service.search({ yearMin: 2018 })
    const [, opts] = searchMock.mock.calls[0]!
    const yearRange = opts.rangeFilters?.find(r => r.field === 'year')
    expect(yearRange?.gte).toBe(2018)
    expect(yearRange?.lte).toBeUndefined()
  })

  it('adds price range as rangeFilters on priceCents', async () => {
    const { service, searchMock } = makeService()
    await service.search({ priceMin: 1000000, priceMax: 5000000 })
    const [, opts] = searchMock.mock.calls[0]!
    const priceRange = opts.rangeFilters?.find(r => r.field === 'priceCents')
    expect(priceRange).toEqual({ field: 'priceCents', gte: 1000000, lte: 5000000 })
  })

  it('adds mileageMax as a rangeFilter lte', async () => {
    const { service, searchMock } = makeService()
    await service.search({ mileageMax: 50000 })
    const [, opts] = searchMock.mock.calls[0]!
    const mileageRange = opts.rangeFilters?.find(r => r.field === 'mileage')
    expect(mileageRange?.lte).toBe(50000)
  })

  it('adds wavFeatures filter as string array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ wavFeatures: ['has_lift'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['wavFeatures']).toEqual(['has_lift'])
  })

  it('adds conversionBrand filter as string array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ conversionBrand: ['braunability', 'vmi'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['conversionBrand']).toEqual(['braunability', 'vmi'])
  })

  it('adds multiple wavFeatures as array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ wavFeatures: ['has_lift', 'hand_controls'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['wavFeatures']).toEqual(['has_lift', 'hand_controls'])
  })

  it('adds state filter as string array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ state: ['CA', 'TX'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['state']).toEqual(['CA', 'TX'])
  })

  it('adds sellerType filter as string array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ sellerType: ['dealer'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['sellerType']).toEqual(['dealer'])
  })

  it('omits sellerType filter when not provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['sellerType']).toBeUndefined()
  })

  it('adds fuelType filter as string array', async () => {
    const { service, searchMock } = makeService()
    await service.search({ fuelType: ['hybrid', 'electric'] })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['fuelType']).toEqual(['hybrid', 'electric'])
  })

  it('omits fuelType filter when not provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['fuelType']).toBeUndefined()
  })

  it('passes sort when provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({ sort: 'priceCents:asc' })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.sort).toEqual(['priceCents:asc'])
  })

  it('omits sort when not provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.sort).toBeUndefined()
  })

  it('returns hits, total, and facets from the SearchService response', async () => {
    const { service, searchMock } = makeService()
    const mockHit = { id: 'abc' } as unknown as ListingDocument
    searchMock.mockResolvedValueOnce({
      hits: [mockHit],
      total: 42,
      facetDistribution: { make: { Toyota: 5 } },
    })
    const result = await service.search({})
    expect(result.hits).toEqual([mockHit])
    expect(result.total).toBe(42)
    expect(result.facets).toEqual({ make: { Toyota: 5 } })
  })

  it('returns total 0 when SearchService returns 0', async () => {
    const { service, searchMock } = makeService()
    searchMock.mockResolvedValueOnce({ hits: [], total: 0, facetDistribution: {} })
    const result = await service.search({})
    expect(result.total).toBe(0)
  })

  it('returns empty facets object when facetDistribution is absent', async () => {
    const { service, searchMock } = makeService()
    searchMock.mockResolvedValueOnce({ hits: [], total: 0 })
    const result = await service.search({})
    expect(result.facets).toEqual({})
  })

  it('passes the search query string through', async () => {
    const { service, searchMock } = makeService()
    await service.search({ q: 'wheelchair van' })
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.query).toBe('wheelchair van')
  })

  it('passes undefined query when q is not provided', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.query).toBeUndefined()
  })

  it('combines make, yearMin, and wavFeatures into separate filter structures', async () => {
    const params: SearchParams = { make: ['Toyota'], yearMin: 2020, wavFeatures: ['has_lift'] }
    const { service, searchMock } = makeService()
    await service.search(params)
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.filters?.['make']).toEqual(['Toyota'])
    expect(opts.filters?.['wavFeatures']).toEqual(['has_lift'])
    expect(opts.rangeFilters?.find(r => r.field === 'year')?.gte).toBe(2020)
  })

  it('passes standard listing facet fields', async () => {
    const { service, searchMock } = makeService()
    await service.search({})
    const [, opts] = searchMock.mock.calls[0]!
    expect(opts.facets).toEqual(
      expect.arrayContaining(['make', 'model', 'year', 'condition', 'conversionType', 'rampType', 'color', 'state', 'sellerType', 'fuelType']),
    )
  })
})
