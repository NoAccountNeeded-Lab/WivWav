import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi } from 'vitest'
import { listingRoutes, snippetDescription } from './listings.js'

const defaultDbListing = {
  id: 'listing-1',
  sourceId: 'source-1',
  sourceUrl: 'https://dealer.example.com/listing/1',
  buyerUrl: null,
  externalId: null,
  stockNumber: null,
  make: 'Toyota',
  model: 'Sienna',
  year: 2022,
  trim: null,
  vin: null,
  condition: 'used',
  sellerType: 'dealer',
  priceCents: 3500000,
  mileage: 20000,
  color: null,
  fuelType: null,
  transmission: null,
  conversionType: 'rear_entry',
  conversionManufacturer: null,
  floorLoweringInches: null,
  rampType: 'in_floor',
  conversionStatus: 'unknown',
  wavFeatures: [],
  wheelchairCapacity: null,
  zip: null,
  city: null,
  state: 'CO',
  lat: null,
  lng: null,
  vehicleId: null,
  vehicleModelId: null,
  vehicleModelMatchConfidence: null,
  dealerName: null,
  dealerPhone: null,
  dealerWebsite: null,
  images: [],
  description: null,
  isDuplicate: false,
  canonicalId: null,
  status: 'active',
  publicationStatus: 'eligible',
  qualityIssueCodes: [],
  qualityCheckedAt: new Date('2024-01-02'),
  saleStatus: 'active',
  goneAt: null,
  soldAt: null,
  listedAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  scrapedAt: new Date('2024-01-02'),
  detailScrapedAt: null,
  source: {
    name: 'Example Dealer',
    baseUrl: 'https://dealer.example.com',
  },
}

function buildDefaultListingRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn(async () => null),
    findCrossListingsByVehicleId: vi.fn(async () => []),
    findByIdForSafety: vi.fn(async () => null),
    findVehicleModelWithSafetyData: vi.fn(async () => null),
    findManyActive: vi.fn(async () => [] as unknown[]),
    countActive: vi.fn(async () => 0),
    findPriceHistory: vi.fn(async () => []),
    ...overrides,
  }
}

function buildTestApp(
  search = { search: vi.fn(async () => ({ hits: [] as unknown[], total: 0, facets: {} as Record<string, unknown> })) },
  listingRepoOverrides: Record<string, unknown> = {},
  facetsOverrides: Partial<{ getFacets: (args: unknown) => Promise<unknown> }> = {},
) {
  const app = Fastify()
  void app.register(sensible)
  const listings = buildDefaultListingRepo(listingRepoOverrides)
  const facets = {
    getFacets: vi.fn(async () => ({
      total: 0,
      priceDistribution: [],
      yearDistribution: [],
      mileageDistribution: [],
      makeBreakdown: [],
      modelBreakdown: [],
      stateBreakdown: [],
      conditionBreakdown: [],
      conversionBreakdown: [],
      colorBreakdown: [],
      rampTypeBreakdown: [],
      sellerTypeBreakdown: [],
      wavFeatureCounts: {},
    })),
    ...facetsOverrides,
  }
  const queueFactory = { createQueue: vi.fn(() => ({ add: vi.fn(async () => 'job-id') })) } as never
  void app.register(listingRoutes, { listings: listings as never, search: search as never, facets: facets as never, queueFactory })
  return { app, listings, search, facets }
}

describe('GET /', () => {
  it('coerces validated query params before searching', async () => {
    const { app, search } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/?page=2&perPage=5&yearMin=2015&wavFeatures=has_lift,hand_controls&make=Honda,Toyota',
    })

    expect(res.statusCode).toBe(200)
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      perPage: 5,
      yearMin: 2015,
      wavFeatures: ['has_lift', 'hand_controls'],
      make: ['Honda', 'Toyota'],
    }))

    await app.close()
  })

  it('passes conversion brand slugs as a multi-value search filter', async () => {
    const { app, search } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/?conversionBrand=braunability,vmi',
    })

    expect(res.statusCode).toBe(200)
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({
      conversionBrand: ['braunability', 'vmi'],
    }))

    await app.close()
  })

  it('passes sellerType as a multi-value search filter', async () => {
    const { app, search } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/?sellerType=dealer',
    })

    expect(res.statusCode).toBe(200)
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({
      sellerType: ['dealer'],
    }))

    await app.close()
  })

  it('accepts bracketed conversion brand query params', async () => {
    const { app, search } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/?conversionBrand[]=braunability,vmi',
    })

    expect(res.statusCode).toBe(200)
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({
      conversionBrand: ['braunability', 'vmi'],
    }))

    await app.close()
  })

  it('rejects invalid pagination query params', async () => {
    const { app, search } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/?perPage=101' })

    expect(res.statusCode).toBe(400)
    expect(search.search).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns correct pagination shape in the response', async () => {
    const search = { search: vi.fn(async () => ({ hits: [{ id: 'a' }, { id: 'b' }], total: 42, facets: { make: { Toyota: 5 } } })) }
    const { app } = buildTestApp(search)

    const res = await app.inject({ method: 'GET', url: '/?page=3&perPage=10' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ pagination: Record<string, unknown>; facets: unknown }>()
    expect(body.pagination).toEqual({ page: 3, perPage: 10, total: 42, totalPages: 5 })
    expect(body.facets).toEqual({ make: { Toyota: 5 } })

    await app.close()
  })

  it('falls back to repository when Meilisearch is unavailable', async () => {
    const failingSearch = { search: vi.fn(async () => { throw new Error('Meilisearch down') }) }
    const dbListings = [{ id: 'row-1' }]
    const { app, listings } = buildTestApp(failingSearch, {
      findManyActive: vi.fn(async () => dbListings),
      countActive: vi.fn(async () => 7),
    })

    const res = await app.inject({ method: 'GET', url: '/?page=2&perPage=5' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[]; facets: unknown; pagination: Record<string, unknown> }>()
    expect(body.data).toEqual(dbListings)
    expect(body.facets).toEqual({})
    expect(body.pagination).toEqual({ page: 2, perPage: 5, total: 7, totalPages: 2 })
    expect(listings.findManyActive).toHaveBeenCalledWith(5, 5)

    await app.close()
  })
})

describe('GET /facets', () => {
  it('coerces validated facet query params before fetching facets', async () => {
    const { app, facets } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/facets?priceMax=5000000&wavFeatures=has_lift&state=CO,UT',
    })

    expect(res.statusCode).toBe(200)
    expect(facets.getFacets).toHaveBeenCalledWith(expect.objectContaining({
      priceMax: 5000000,
      wavFeatures: ['has_lift'],
      state: ['CO', 'UT'],
    }))

    await app.close()
  })

  it('passes conversion brand slugs to facet filtering', async () => {
    const { app, facets } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/facets?conversionBrand=braunability,vmi',
    })

    expect(res.statusCode).toBe(200)
    expect(facets.getFacets).toHaveBeenCalledWith(expect.objectContaining({
      conversionBrand: ['braunability', 'vmi'],
    }))

    await app.close()
  })

  it('passes sellerType to facet filtering', async () => {
    const { app, facets } = buildTestApp()

    const res = await app.inject({
      method: 'GET',
      url: '/facets?sellerType=private',
    })

    expect(res.statusCode).toBe(200)
    expect(facets.getFacets).toHaveBeenCalledWith(expect.objectContaining({
      sellerType: ['private'],
    }))

    await app.close()
  })

  it('rejects invalid numeric facet query params', async () => {
    const { app, facets } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/facets?yearMin=nope' })

    expect(res.statusCode).toBe(400)
    expect(facets.getFacets).not.toHaveBeenCalled()

    await app.close()
  })

  it('returns empty distributions when Meilisearch is unavailable', async () => {
    const { app } = buildTestApp(undefined, {}, {
      getFacets: vi.fn(async () => { throw new Error('Meilisearch down') }),
    })

    const res = await app.inject({ method: 'GET', url: '/facets' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data).toEqual({
      total: 0,
      priceDistribution: [],
      yearDistribution: [],
      mileageDistribution: [],
      makeBreakdown: [],
      modelBreakdown: [],
      stateBreakdown: [],
      conditionBreakdown: [],
      conversionBreakdown: [],
      colorBreakdown: [],
      rampTypeBreakdown: [],
      sellerTypeBreakdown: [],
      wavFeatureCounts: {},
    })

    await app.close()
  })
})

describe('GET /:id — provenance', () => {
  it('returns 404 when the repository hides a missing or non-eligible listing', async () => {
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/nonexistent-id' })

    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('returns full provenance when all fields are present', async () => {
    const listing = {
      ...defaultDbListing,
      buyerUrl: 'https://dealer.example.com/buy/1',
      detailScrapedAt: new Date('2024-01-03'),
      vehicleModelMatchConfidence: 'high',
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { provenance: Record<string, unknown> } }>()
    expect(body.data.provenance).toMatchObject({
      sourceName: 'Example Dealer',
      sourceBaseUrl: 'https://dealer.example.com',
      sourceUrl: 'https://dealer.example.com/listing/1',
      buyerUrl: 'https://dealer.example.com/buy/1',
      detailScrapedAt: '2024-01-03T00:00:00.000Z',
      vehicleModelMatchConfidence: 'high',
      qualityCheckedAt: '2024-01-02T00:00:00.000Z',
    })

    await app.close()
  })

  it('includes active cross-listings for the same vehicle', async () => {
    const listing = {
      ...defaultDbListing,
      vehicleId: 'vehicle-1',
    }
    const crossListing = {
      id: 'listing-2',
      sourceUrl: 'https://dealer-two.example.com/listing/2',
      buyerUrl: 'https://dealer-two.example.com/buy/2',
      sellerType: 'dealer',
      priceCents: 3600000,
      zip: '78701',
      city: 'Austin',
      state: 'TX',
      dealerName: 'Austin Mobility',
      dealerPhone: '512-555-0100',
      dealerWebsite: 'https://austinmobility.example.com',
    }
    const { app, listings } = buildTestApp(undefined, {
      findById: vi.fn(async () => listing),
      findCrossListingsByVehicleId: vi.fn(async () => [crossListing]),
    })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    expect(listings.findCrossListingsByVehicleId).toHaveBeenCalledWith('vehicle-1', 'listing-1')
    expect(res.json().data.crossListings).toEqual([
      {
        id: 'listing-2',
        sourceUrl: 'https://dealer-two.example.com/listing/2',
        buyerUrl: 'https://dealer-two.example.com/buy/2',
        sellerType: 'dealer',
        priceCents: 3600000,
        location: { zip: '78701', city: 'Austin', state: 'TX' },
        dealer: {
          name: 'Austin Mobility',
          phone: '512-555-0100',
          website: 'https://austinmobility.example.com',
        },
      },
    ])

    await app.close()
  })

  it('does not query cross-listings when the listing has no vehicle identity', async () => {
    const { app, listings } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    expect(listings.findCrossListingsByVehicleId).not.toHaveBeenCalled()
    expect(res.json().data.crossListings).toEqual([])

    await app.close()
  })

  it('returns null for optional provenance fields when absent', async () => {
    const listing = { ...defaultDbListing, qualityCheckedAt: null }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { provenance: Record<string, unknown> } }>()
    expect(body.data.provenance).toMatchObject({
      sourceName: 'Example Dealer',
      sourceBaseUrl: 'https://dealer.example.com',
      sourceUrl: 'https://dealer.example.com/listing/1',
      buyerUrl: null,
      detailScrapedAt: null,
      vehicleModelMatchConfidence: null,
      qualityCheckedAt: null,
    })

    await app.close()
  })

  it('wraps response in { data } envelope', async () => {
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<Record<string, unknown>>()
    expect(Object.keys(body)).toContain('data')
    expect(Object.keys(body)).not.toContain('error')

    await app.close()
  })

  it('does not leak the raw source relation into the top-level response', async () => {
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.source).toBeUndefined()
    expect(body.data.sourceId).toBeUndefined()

    await app.close()
  })
})

describe('GET /:id — nested mapping (toListingDetailResponse)', () => {
  it('nests dealer fields under data.dealer', async () => {
    const listing = {
      ...defaultDbListing,
      dealerName: 'Mobility Motors',
      dealerPhone: '303-555-0101',
      dealerWebsite: 'https://mobilitymotors.example.com',
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.dealer).toEqual({
      name: 'Mobility Motors',
      phone: '303-555-0101',
      website: 'https://mobilitymotors.example.com',
    })

    await app.close()
  })

  it('sets all dealer fields to null when absent', async () => {
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.dealer).toEqual({ name: null, phone: null, website: null })

    await app.close()
  })

  it('suppresses dealer.phone for private-seller listings', async () => {
    const listing = {
      ...defaultDbListing,
      sellerType: 'private',
      dealerName: 'Jane Smith',
      dealerPhone: '720-555-0199',
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    // Phone number is personal data; name is normalized to generic label for private sellers
    expect(body.data.dealer).toEqual({ name: 'For Sale By Owner', phone: null, website: null })

    await app.close()
  })

  it('retains dealer.phone for dealer listings', async () => {
    const listing = {
      ...defaultDbListing,
      sellerType: 'dealer',
      dealerName: 'Mobility Motors',
      dealerPhone: '303-555-0101',
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    // Dealer phone is business contact info — must be retained
    expect(body.data.dealer).toEqual({ name: 'Mobility Motors', phone: '303-555-0101', website: null })

    await app.close()
  })

  it('nests location fields under data.location', async () => {
    const listing = {
      ...defaultDbListing,
      zip: '80202',
      city: 'Denver',
      state: 'CO',
      lat: 39.7392,
      lng: -104.9903,
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.location).toEqual({
      zip: '80202',
      city: 'Denver',
      state: 'CO',
      lat: 39.7392,
      lng: -104.9903,
    })

    await app.close()
  })

  it('sets all location fields to null when absent', async () => {
    const listing = { ...defaultDbListing, zip: null, city: null, state: null, lat: null, lng: null }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.location).toEqual({ zip: null, city: null, state: null, lat: null, lng: null })

    await app.close()
  })

  it('nests WAV fields under data.wav', async () => {
    const listing = {
      ...defaultDbListing,
      conversionType: 'side_entry',
      conversionManufacturer: 'BraunAbility',
      floorLoweringInches: 4,
      rampType: 'fold_out',
      conversionStatus: 'complete',
      wavFeatures: ['has_lift', 'hand_controls', 'transfer_seat'],
      wheelchairCapacity: 2,
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.wav).toEqual({
      conversionType: 'side_entry',
      conversionManufacturer: 'BraunAbility',
      floorLoweringInches: 4,
      rampType: 'fold_out',
      conversionStatus: 'complete',
      wavFeatures: ['has_lift', 'hand_controls', 'transfer_seat'],
      wheelchairCapacity: 2,
    })

    await app.close()
  })

  it('sets optional WAV fields to null when absent', async () => {
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.wav).toMatchObject({
      conversionType: 'rear_entry',
      conversionManufacturer: null,
      floorLoweringInches: null,
      rampType: 'in_floor',
      conversionStatus: 'unknown',
      wavFeatures: [],
      wheelchairCapacity: null,
    })

    await app.close()
  })

  it('does not expose flat dealer/location/wav fields at the top level of data', async () => {
    const listing = {
      ...defaultDbListing,
      dealerName: 'Mobility Motors',
      dealerPhone: '303-555-0101',
      dealerWebsite: 'https://mobilitymotors.example.com',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
      lat: 39.7392,
      lng: -104.9903,
    }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.dealerName).toBeUndefined()
    expect(body.data.dealerPhone).toBeUndefined()
    expect(body.data.dealerWebsite).toBeUndefined()
    expect(body.data.city).toBeUndefined()
    expect(body.data.state).toBeUndefined()
    expect(body.data.zip).toBeUndefined()
    expect(body.data.lat).toBeUndefined()
    expect(body.data.lng).toBeUndefined()
    expect(body.data.conversionType).toBeUndefined()
    expect(body.data.rampType).toBeUndefined()
    expect(body.data.wavFeatures).toBeUndefined()

    await app.close()
  })

  it('does not expose scrapedAt at the top level of data', async () => {
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => defaultDbListing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown> }>()
    expect(body.data.scrapedAt).toBeUndefined()

    await app.close()
  })

  it('returns 500 when source relation is missing from the listing', async () => {
    const listing = { ...defaultDbListing, source: null }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(500)

    await app.close()
  })
})

// ── GET /:id/safety — investigations and manufacturer communications ────────

describe('GET /:id/safety', () => {
  it('returns empty investigations and manufacturerCommunications when vehicleModelId is null', async () => {
    const listing = { id: 'listing-1', vehicleModelId: null }
    const { app } = buildTestApp(undefined, {
      findByIdForSafety: vi.fn(async () => listing),
    })
    const res = await app.inject({ method: 'GET', url: '/listing-1/safety' })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.vehicleModel).toBeNull()
    expect(data.investigations).toEqual([])
    expect(data.manufacturerCommunications).toEqual([])
    await app.close()
  })

  it('includes investigations and manufacturerCommunications from vehicleModel safety data', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const listing = { id: 'listing-1', vehicleModelId: 'vm-1' }
    const vehicleModel = {
      id: 'vm-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2020,
      trim: null,
      bodyType: null,
      recalls: [],
      complaints: [],
      safetyRatings: [],
      investigations: [
        {
          id: 'inv-1',
          nhtsaId: 'PE24001',
          component: 'Steering',
          summary: 'Potential steering loss',
          openedDate: new Date('2024-01-15'),
          closedDate: null,
          outcome: null,
          sourceUrl: 'https://www.nhtsa.gov/vehicle-safety/recalls-and-investigations#investigations&investigationId=PE24001',
          refreshedAt: now,
        },
      ],
      manufacturerCommunications: [
        {
          id: 'comm-1',
          nhtsaId: 'TSB-2024-001',
          component: 'Electrical system',
          summary: 'Battery drain',
          issuedDate: new Date('2024-02-01'),
          sourceUrl: 'https://www.nhtsa.gov/vehicle/safety-issues/tsbs?tsbId=TSB-2024-001',
          refreshedAt: now,
        },
      ],
    }
    const { app } = buildTestApp(undefined, {
      findByIdForSafety: vi.fn(async () => listing),
      findVehicleModelWithSafetyData: vi.fn(async () => vehicleModel),
    })
    const res = await app.inject({ method: 'GET', url: '/listing-1/safety' })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    // Investigations are source-backed: each record has sourceUrl pointing to NHTSA
    expect(data.investigations).toHaveLength(1)
    expect(data.investigations[0]).toMatchObject({
      nhtsaId: 'PE24001',
      component: 'Steering',
      sourceUrl: expect.stringContaining('nhtsa.gov'),
    })
    // Manufacturer communications (TSBs) likewise source-backed
    expect(data.manufacturerCommunications).toHaveLength(1)
    expect(data.manufacturerCommunications[0]).toMatchObject({
      nhtsaId: 'TSB-2024-001',
      component: 'Electrical system',
      sourceUrl: expect.stringContaining('nhtsa.gov'),
    })
    await app.close()
  })

  it('returns empty investigations and manufacturerCommunications when vehicleModel has none', async () => {
    const listing = { id: 'listing-1', vehicleModelId: 'vm-1' }
    const vehicleModel = {
      id: 'vm-1',
      make: 'Honda',
      model: 'Odyssey',
      year: 2022,
      trim: null,
      bodyType: null,
      recalls: [],
      complaints: [],
      safetyRatings: [],
      investigations: [],
      manufacturerCommunications: [],
    }
    const { app } = buildTestApp(undefined, {
      findByIdForSafety: vi.fn(async () => listing),
      findVehicleModelWithSafetyData: vi.fn(async () => vehicleModel),
    })
    const res = await app.inject({ method: 'GET', url: '/listing-1/safety' })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    // Missing source state: both arrays are empty — handled gracefully
    expect(data.investigations).toEqual([])
    expect(data.manufacturerCommunications).toEqual([])
    await app.close()
  })
})

describe('snippetDescription', () => {
  it('returns null for null input', () => {
    expect(snippetDescription(null)).toBeNull()
  })

  it('returns the full text when it is at or below the limit', () => {
    const short = 'A'.repeat(300)
    expect(snippetDescription(short)).toBe(short)
  })

  it('truncates text that exceeds the limit and appends an ellipsis', () => {
    const long = 'A'.repeat(400)
    const result = snippetDescription(long)
    expect(result).not.toBeNull()
    expect(result!.endsWith('…')).toBe(true)
    // The snippet must be no longer than DESCRIPTION_SNIPPET_LENGTH chars + the ellipsis character
    // (300 chars from the original text, then '…' which is 1 char)
    expect(result!.length).toBeLessThanOrEqual(301)
  })

  it('trims leading and trailing whitespace before measuring', () => {
    const padded = '  hello  '
    expect(snippetDescription(padded)).toBe('hello')
  })

  it('does not append ellipsis when trimmed text fits within the limit', () => {
    const justRight = 'B'.repeat(299)
    const result = snippetDescription(justRight)
    expect(result).toBe(justRight)
    expect(result!.endsWith('…')).toBe(false)
  })

  it('does not expose full descriptions in the GET /:id response', async () => {
    const longDesc = 'X'.repeat(600)
    const listing = { ...defaultDbListing, description: longDesc }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { description: string } }>()
    expect(body.data.description.length).toBeLessThanOrEqual(301)
    expect(body.data.description.endsWith('…')).toBe(true)

    await app.close()
  })

  it('passes through a short description unchanged in the GET /:id response', async () => {
    const shortDesc = 'Great WAV in excellent condition.'
    const listing = { ...defaultDbListing, description: shortDesc }
    const { app } = buildTestApp(undefined, { findById: vi.fn(async () => listing) })

    const res = await app.inject({ method: 'GET', url: '/listing-1' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { description: string } }>()
    expect(body.data.description).toBe(shortDesc)

    await app.close()
  })
})
