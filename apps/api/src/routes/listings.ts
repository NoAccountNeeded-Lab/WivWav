import type { FastifyPluginAsync } from 'fastify'
import type { Listing } from '@wivwav/db'
import type { BullMQQueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { ListingSearchService } from '../services/listing-search.js'
import type { ListingFacetsService } from '../services/listing-facets.js'
import type { CrossListingRow, ListingRepository } from '../repositories/index.js'

const REFRESH_RATE_LIMIT_MS = 60 * 60 * 1000 // 1 hour per vehicle model
const refreshedAt = new Map<string, number>()

type ListingWithRequiredSource = Listing & { source: { name: string; baseUrl: string } }
type CrossListingResponse = ReturnType<typeof toCrossListingResponse>

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

function toListingDetailResponse(listing: ListingWithRequiredSource, crossListings: CrossListingResponse[] = []) {
  const {
    source,
    sourceId,
    scrapedAt,
    sourceUrl,
    buyerUrl,
    detailScrapedAt,
    vehicleModelMatchConfidence,
    publicationStatus,
    qualityIssueCodes,
    qualityCheckedAt,
    dealerName, dealerPhone, dealerWebsite,
    lat, lng, zip, city, state,
    conversionType, conversionManufacturer, floorLoweringInches,
    rampType, conversionStatus, wavFeatures, wheelchairCapacity,
    description,
    ...rest
  } = listing
  void sourceId
  void publicationStatus
  void qualityIssueCodes
  void qualityCheckedAt

  const isPrivate = rest.sellerType === 'private'
  // Suppress personal phone numbers; normalize name to a generic label for private sellers.
  // Both are personal data under CCPA/state privacy laws; dealer equivalents are business info.
  const phone = isPrivate ? null : dealerPhone
  const name = isPrivate ? 'For Sale By Owner' : dealerName

  return {
    ...rest,
    sourceUrl,
    buyerUrl,
    description: snippetDescription(description),
    location: { zip, city, state, lat, lng },
    dealer: { name, phone, website: dealerWebsite },
    wav: { conversionType, conversionManufacturer, floorLoweringInches, rampType, conversionStatus, wavFeatures, wheelchairCapacity },
    crossListings,
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

function toCrossListingResponse(listing: CrossListingRow) {
  const isPrivate = listing.sellerType === 'private'
  return {
    id: listing.id,
    sourceUrl: listing.sourceUrl,
    buyerUrl: listing.buyerUrl,
    sellerType: listing.sellerType,
    priceCents: listing.priceCents,
    location: {
      zip: listing.zip,
      city: listing.city,
      state: listing.state,
    },
    dealer: {
      name: isPrivate ? 'For Sale By Owner' : listing.dealerName,
      phone: isPrivate ? null : listing.dealerPhone,
      website: listing.dealerWebsite,
    },
  }
}

interface ListingsPluginOptions {
  listings: ListingRepository
  search: ListingSearchService
  facets: ListingFacetsService
  queueFactory: BullMQQueueFactory
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
  conversionBrand?: string
  'conversionBrand[]'?: string
  conversionType?: string
  rampType?: string
  wavFeatures?: string
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
    conversionBrand: { type: 'string' },
    'conversionBrand[]': { type: 'string' },
    conversionType: { type: 'string' },
    rampType: { type: 'string' },
    wavFeatures: { type: 'string' },
    color: { type: 'string' },
    state: { type: 'string' },
    sort: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  additionalProperties: false,
} as const

export const listingRoutes: FastifyPluginAsync<ListingsPluginOptions> = async (app, { listings, search, facets, queueFactory }) => {
  const recallsQueue = queueFactory.createQueue(QUEUES.NHTSA_RECALLS)
  const complaintsQueue = queueFactory.createQueue(QUEUES.NHTSA_COMPLAINTS)
  const safetyRatingsQueue = queueFactory.createQueue(QUEUES.NHTSA_SAFETY_RATINGS)
  const investigationsQueue = queueFactory.createQueue(QUEUES.NHTSA_INVESTIGATIONS)
  const manufacturerCommunicationsQueue = queueFactory.createQueue(QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS)

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
        conversionBrand: parseArrs(q.conversionBrand, q['conversionBrand[]']),
        conversionType: parseArr(q.conversionType),
        rampType: parseArr(q.rampType),
        wavFeatures: parseArr(q.wavFeatures),
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
          rampTypeBreakdown: [],
          wavFeatureCounts: {},
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
        conversionBrand: parseArrs(q.conversionBrand, q['conversionBrand[]']),
        conversionType: parseArr(q.conversionType),
        rampType: parseArr(q.rampType),
        wavFeatures: parseArr(q.wavFeatures),
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

      const crossListings = listing.vehicleId
        ? await listings.findCrossListingsByVehicleId(listing.vehicleId, listing.id)
        : []

      return reply.send({
        data: toListingDetailResponse(
          listing as ListingWithRequiredSource,
          crossListings.map(toCrossListingResponse),
        ),
      })
    } catch (err) {
      req.log.error(err, '[listings/:id] failed to fetch listing')
      return reply.internalServerError('Failed to fetch listing')
    }
  })

  app.get<{ Params: { id: string } }>('/:id/safety', async (req, reply) => {
    const listing = await listings.findByIdForSafety(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    if (!listing.vehicleModelId) return reply.send({ data: { vehicleModel: null, recalls: [], complaints: [], safetyRatings: [], safetyFreshnessDate: null, investigations: [], manufacturerCommunications: [] } })

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

    // Investigations: source URL is stored per record — expose as-is
    const investigations = vehicleModel?.investigations ?? []

    // Manufacturer communications (TSBs): source URL stored per record
    const manufacturerCommunications = vehicleModel?.manufacturerCommunications ?? []

    return reply.send({
      data: {
        vehicleModel: vehicleModel
          ? { id: vehicleModel.id, make: vehicleModel.make, model: vehicleModel.model, year: vehicleModel.year, trim: vehicleModel.trim, bodyType: vehicleModel.bodyType }
          : null,
        recalls,
        complaints: vehicleModel?.complaints ?? [],
        safetyRatings,
        safetyFreshnessDate,
        investigations,
        manufacturerCommunications,
      },
    })
  })

  app.post<{ Params: { id: string } }>(
    '/:id/refresh-safety',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const listing = await listings.findByIdForSafety(req.params.id)
      if (!listing) return reply.notFound('Listing not found')
      if (!listing.vehicleModelId) {
        return reply.send({ data: { enqueued: false, reason: 'no-vehicle-model' } })
      }

      const vehicleModelId = listing.vehicleModelId
      const last = refreshedAt.get(vehicleModelId) ?? 0
      const now = Date.now()

      if (now - last < REFRESH_RATE_LIMIT_MS) {
        return reply.send({ data: { enqueued: false, reason: 'rate-limited', retryAfter: Math.ceil((last + REFRESH_RATE_LIMIT_MS - now) / 1000) } })
      }

      refreshedAt.set(vehicleModelId, now)

      const jobData = { vehicleModelId }
      const [recallsId, complaintsId, ratingsId, investigationsId, communicationsId] = await Promise.all([
        recallsQueue.add(jobData),
        complaintsQueue.add(jobData),
        safetyRatingsQueue.add(jobData),
        investigationsQueue.add(jobData),
        manufacturerCommunicationsQueue.add(jobData),
      ])

      req.log.info({ vehicleModelId, recallsId, complaintsId, ratingsId, investigationsId, communicationsId }, '[listings/refresh-safety] enqueued scoped NHTSA refresh')
      return reply.code(202).send({ data: { enqueued: true, jobIds: { recalls: recallsId, complaints: complaintsId, ratings: ratingsId, investigations: investigationsId, communications: communicationsId } } })
    },
  )

  app.get<{ Params: { id: string } }>('/:id/price-history', async (req, reply) => {
    const listing = await listings.findByIdForSafety(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    const history = await listings.findPriceHistory(req.params.id)
    return reply.send({ data: history })
  })

  app.get<{ Params: { id: string } }>('/:id/dealer', async (req, reply) => {
    const listing = await listings.findByIdForDealer(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    if (!listing.dealerProfileId) {
      return reply.send({ data: { dealerProfile: null } })
    }
    const dealerProfile = await listings.findDealerProfile(listing.dealerProfileId)
    return reply.send({ data: { dealerProfile } })
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

function parseArrs(...values: Array<string | undefined>): string[] | undefined {
  const parts = values.flatMap((value) => parseArr(value) ?? [])
  return parts.length ? [...new Set(parts)] : undefined
}
