import type { FastifyPluginAsync } from 'fastify'
import type { Listing } from '@wivwav/db'
import type { ListingSearchService } from '../services/listing-search.js'
import type { ListingFacetsService } from '../services/listing-facets.js'
import type { ListingRepository } from '../repositories/index.js'

type ListingWithRequiredSource = Listing & { source: { name: string; baseUrl: string } }

/**
 * Maximum characters of third-party dealer copy exposed in the public API.
 * Full descriptions are retained in the database for WAV-feature extraction
 * by the scraper agents, but the public detail response is capped here to
 * avoid reproducing potentially-copyrighted seller copy verbatim.
 * Source attribution and an outbound link are always included in provenance.
 */
const DESCRIPTION_SNIPPET_LENGTH = 300

export function snippetDescription(description: string | null): string | null {
  if (description === null) return null
  const trimmed = description.trim()
  if (trimmed.length <= DESCRIPTION_SNIPPET_LENGTH) return trimmed
  return trimmed.slice(0, DESCRIPTION_SNIPPET_LENGTH).trimEnd() + '…'
}

function toListingDetailResponse(listing: ListingWithRequiredSource) {
  const {
    source,
    sourceId,
    scrapedAt,
    sourceUrl,
    buyerUrl,
    detailScrapedAt,
    vehicleModelMatchConfidence,
    dealerName, dealerPhone, dealerWebsite,
    lat, lng, zip, city, state,
    conversionType, conversionManufacturer, floorLoweringInches,
    rampType, hasLift, handControls, transferSeat, wheelchairCapacity,
    description,
    ...rest
  } = listing
  void sourceId

  const isPrivate = rest.sellerType === 'private'
  // Suppress personal phone numbers; normalize name to a generic label for private sellers.
  // Both are personal data under CCPA/state privacy laws; dealer equivalents are business info.
  const phone = isPrivate ? null : dealerPhone
  const name = isPrivate ? 'For Sale By Owner' : dealerName

  return {
    ...rest,
    description: snippetDescription(description),
    location: { zip, city, state, lat, lng },
    dealer: { name, phone, website: dealerWebsite },
    wav: { conversionType, conversionManufacturer, floorLoweringInches, rampType, hasLift, handControls, transferSeat, wheelchairCapacity },
    provenance: {
      sourceName: source.name,
      sourceBaseUrl: source.baseUrl,
      sourceUrl,
      buyerUrl,
      scrapedAt,
      detailScrapedAt,
      vehicleModelMatchConfidence,
    },
  }
}

interface ListingsPluginOptions {
  listings: ListingRepository
  search: ListingSearchService
  facets: ListingFacetsService
}

interface FilterQuery {
  q?: string
  make?: string
  model?: string
  yearMin?: number
  yearMax?: number
  priceMin?: number
  priceMax?: number
  mileageMax?: number
  condition?: string
  conversionType?: string
  rampType?: string
  hasLift?: boolean
  handControls?: boolean
  color?: string
  state?: string
  sort?: string
  page?: number
  perPage?: number
}

const filterQuerySchema = {
  type: 'object',
  properties: {
    q: { type: 'string' },
    make: { type: 'string' },
    model: { type: 'string' },
    yearMin: { type: 'integer' },
    yearMax: { type: 'integer' },
    priceMin: { type: 'integer' },
    priceMax: { type: 'integer' },
    mileageMax: { type: 'integer' },
    condition: { type: 'string' },
    conversionType: { type: 'string' },
    rampType: { type: 'string' },
    hasLift: { type: 'boolean' },
    handControls: { type: 'boolean' },
    color: { type: 'string' },
    state: { type: 'string' },
    sort: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  additionalProperties: false,
} as const

export const listingRoutes: FastifyPluginAsync<ListingsPluginOptions> = async (app, { listings, search, facets }) => {
  app.get<{ Querystring: FilterQuery }>('/facets', { schema: { querystring: filterQuerySchema } }, async (req, reply) => {
    const q = req.query
    try {
      const result = await facets.getFacets({
        q: q.q,
        make: parseArr(q.make),
        model: parseArr(q.model),
        yearMin: q.yearMin,
        yearMax: q.yearMax,
        priceMin: q.priceMin,
        priceMax: q.priceMax,
        mileageMax: q.mileageMax,
        condition: parseArr(q.condition),
        conversionType: parseArr(q.conversionType),
        rampType: parseArr(q.rampType),
        hasLift: q.hasLift,
        handControls: q.handControls,
        color: parseArr(q.color),
        state: parseArr(q.state),
      })
      return reply.send({ data: result })
    } catch (err) {
      req.log.warn(err, '[facets] Meilisearch unavailable, returning empty distributions')
      return reply.send({
        data: {
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
          wavFeatures: { hasLift: 0, handControls: 0, rampTypes: [] },
        },
      })
    }
  })

  app.get<{ Querystring: FilterQuery }>('/', { schema: { querystring: filterQuerySchema } }, async (req, reply) => {
    const q = req.query
    const page = q.page ?? 1
    const perPage = q.perPage ?? 20

    try {
      const result = await search.search({
        q: q.q,
        page,
        perPage,
        make: parseArr(q.make),
        model: parseArr(q.model),
        yearMin: q.yearMin,
        yearMax: q.yearMax,
        priceMin: q.priceMin,
        priceMax: q.priceMax,
        mileageMax: q.mileageMax,
        condition: parseArr(q.condition),
        conversionType: parseArr(q.conversionType),
        rampType: parseArr(q.rampType),
        hasLift: q.hasLift,
        handControls: q.handControls,
        color: parseArr(q.color),
        state: parseArr(q.state),
        sort: q.sort,
      })

      return reply.send({
        data: result.hits,
        facets: result.facets,
        pagination: {
          page,
          perPage,
          total: result.total,
          totalPages: Math.ceil(result.total / perPage),
        },
      })
    } catch (err) {
      // Meilisearch unavailable — fall back to repository query
      req.log.warn(err, '[listings] Meilisearch unavailable, falling back to repository')
      const skip = (page - 1) * perPage
      const [rows, total] = await Promise.all([
        listings.findManyActive(skip, perPage),
        listings.countActive(),
      ])
      return reply.send({
        data: rows,
        facets: {},
        pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      })
    }
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      const listing = await listings.findById(req.params.id)
      if (!listing) return reply.notFound('Listing not found')
      if (!listing.source) return reply.internalServerError('Listing source not found')

      return reply.send({ data: toListingDetailResponse(listing as ListingWithRequiredSource) })
    } catch (err) {
      req.log.error(err, '[listings/:id] failed to fetch listing')
      return reply.internalServerError('Failed to fetch listing')
    }
  })

  app.get<{ Params: { id: string } }>('/:id/safety', async (req, reply) => {
    const listing = await listings.findByIdForSafety(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    if (!listing.vehicleModelId) return reply.send({ data: { vehicleModel: null, recalls: [], complaints: [], safetyRatings: [], safetyFreshnessDate: null } })

    const vehicleModel = await listings.findVehicleModelWithSafetyData(listing.vehicleModelId)

    const rawRecalls = vehicleModel?.recalls ?? []
    const recalls = rawRecalls.map((r) => ({ ...r, status: normalizeRecallStatus(r.remedy) }))

    // Freshness date: the most recent refreshedAt from safety ratings, or null when unavailable
    const rawRatings = vehicleModel?.safetyRatings ?? []
    const safetyFreshnessDate = rawRatings.reduce<string | null>((latest, r) => {
      if (!r.refreshedAt) return latest
      const iso = r.refreshedAt.toISOString()
      return latest === null || iso > latest ? iso : latest
    }, null)
    // Strip refreshedAt from each rating — it is already aggregated into safetyFreshnessDate
    const safetyRatings = rawRatings.map(({ refreshedAt: _unused, ...rest }) => rest)

    return reply.send({
      data: {
        vehicleModel: vehicleModel
          ? { id: vehicleModel.id, make: vehicleModel.make, model: vehicleModel.model, year: vehicleModel.year, trim: vehicleModel.trim, bodyType: vehicleModel.bodyType }
          : null,
        recalls,
        complaints: vehicleModel?.complaints ?? [],
        safetyRatings,
        safetyFreshnessDate,
      },
    })
  })

  app.get<{ Params: { id: string } }>('/:id/price-history', async (req, reply) => {
    const listing = await listings.findByIdForSafety(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    const history = await listings.findPriceHistory(req.params.id)
    return reply.send({ data: history })
  })

}

type RecallStatus = 'open' | 'remedied' | 'unknown'

function normalizeRecallStatus(remedy: string | null | undefined): RecallStatus {
  if (remedy === null || remedy === undefined || remedy.trim() === '') return 'open'
  if (remedy.trim().toLowerCase() === 'unknown') return 'unknown'
  return 'remedied'
}

function parseArr(v: string | undefined): string[] | undefined {
  if (!v) return undefined
  const parts = v.split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}
