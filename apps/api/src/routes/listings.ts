import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Listing } from '@wivwav/db'
import type { BullMQQueueFactory } from '@wivwav/queue'
import { QUEUES } from '@wivwav/queue'
import type { ListingSearchService } from '../services/listing-search.js'
import type { ListingFacetsService } from '../services/listing-facets.js'
import type { CrossListingRow, ListingReportType, ListingRepository } from '../repositories/index.js'

const REFRESH_RATE_LIMIT_MS = 60 * 60 * 1000 // 1 hour per vehicle model
const refreshedAt = new Map<string, number>()

type ListingWithRequiredSource = Listing & { source: { name: string; baseUrl: string } }
type CrossListingResponse = ReturnType<typeof toCrossListingResponse>
type ListingReportSummary = { unresolvedCount: number; flagged: boolean }

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

function toListingDetailResponse(
  listing: ListingWithRequiredSource,
  crossListings: CrossListingResponse[] = [],
  reportSummary: ListingReportSummary = { unresolvedCount: 0, flagged: false },
) {
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
    conversionTypeResolution, rampTypeResolution,
    description,
    ...rest
  } = listing
  void sourceId
  void publicationStatus
  void qualityIssueCodes

  const isPrivate = rest.sellerType === 'private'
  // Suppress personal phone numbers; normalize name to a generic label for private sellers.
  // Both are personal data under CCPA/state privacy laws; dealer equivalents are business info.
  const phone = isPrivate ? null : dealerPhone
  const name = isPrivate ? 'For Sale By Owner' : dealerName

  // #499: the resolver already writes `unknown` to conversionType/rampType
  // while conflicting (see apps/scraper/src/resolution), but this is the
  // public response boundary — never let a `conflicting` field read as a
  // definitive side/rear/ramp value here even if that invariant is ever
  // violated upstream.
  const publicConversionType = conversionTypeResolution === 'conflicting' ? 'unknown' : conversionType
  const publicRampType = rampTypeResolution === 'conflicting' ? 'unknown' : rampType

  return {
    ...rest,
    sourceUrl,
    buyerUrl,
    description: snippetDescription(description),
    location: { zip, city, state, lat, lng },
    dealer: { name, phone, website: dealerWebsite },
    wav: {
      conversionType: publicConversionType,
      conversionManufacturer,
      floorLoweringInches,
      rampType: publicRampType,
      conversionStatus,
      wavFeatures,
      wheelchairCapacity,
    },
    fieldResolution: { conversionType: conversionTypeResolution, rampType: rampTypeResolution },
    reportSummary,
    crossListings,
    provenance: {
      sourceName: source.name,
      sourceBaseUrl: source.baseUrl,
      sourceUrl,
      buyerUrl,
      scrapedAt,
      detailScrapedAt,
      vehicleModelMatchConfidence,
      qualityCheckedAt,
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

const filterQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String()),
    make: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    trim: Type.Optional(Type.String()),
    yearMin: Type.Optional(Type.Integer()),
    yearMax: Type.Optional(Type.Integer()),
    priceMin: Type.Optional(Type.Integer()),
    priceMax: Type.Optional(Type.Integer()),
    mileageMax: Type.Optional(Type.Integer()),
    condition: Type.Optional(Type.String()),
    conversionBrand: Type.Optional(Type.String()),
    'conversionBrand[]': Type.Optional(Type.String()),
    conversionType: Type.Optional(Type.String()),
    rampType: Type.Optional(Type.String()),
    wavFeatures: Type.Optional(Type.String()),
    color: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    sellerType: Type.Optional(Type.String()),
    sort: Type.Optional(Type.String()),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    perPage: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
)

// A single named facet bucket, e.g. `{ value: 'Toyota', count: 12 }`.
const facetCountSchema = Type.Object({ value: Type.String(), count: Type.Number() })

// Mirrors `FacetsResult` (apps/api/src/services/listing-facets.ts) field-for-field so the
// generated OpenAPI document stays the single source of truth for this exemplar route.
// Every field is `Type.Optional` — fast-json-stringify throws on a required property that
// is absent from the payload, and callers (including this route's Meilisearch-outage
// fallback branch) are not guaranteed to populate every breakdown — so optional keeps
// serialization behaviour unchanged while still validating the type of whatever is present.
const facetsResultSchema = Type.Object({
  total: Type.Optional(Type.Number()),
  priceDistribution: Type.Optional(Type.Array(Type.Object({ bucket: Type.String(), count: Type.Number() }))),
  yearDistribution: Type.Optional(Type.Array(Type.Object({ year: Type.Number(), count: Type.Number() }))),
  mileageDistribution: Type.Optional(Type.Array(Type.Object({ bucket: Type.String(), count: Type.Number() }))),
  makeBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  modelBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  trimBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  stateBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  conditionBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  conversionBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  colorBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  rampTypeBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  sellerTypeBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  conversionBrandBreakdown: Type.Optional(Type.Array(facetCountSchema)),
  wavFeatureCounts: Type.Optional(Type.Record(Type.String(), Type.Number())),
})

const facetsResponseSchema = Type.Object({ data: facetsResultSchema })

const searchUnavailableResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.Literal('SEARCH_UNAVAILABLE'),
    message: Type.String(),
  }),
})

const reportTypeSchema = Type.Union([
  Type.Literal('specs_incorrect'),
  Type.Literal('sold_or_stale'),
  Type.Literal('duplicate'),
  Type.Literal('other'),
])

const createListingReportBodySchema = Type.Object(
  {
    reportType: reportTypeSchema,
    notes: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
)

// `data` holds either Meilisearch-sourced `ListingDocument` hits or, on Meilisearch
// fallback, raw repository rows — two different shapes sharing one envelope. Left
// unconstrained (`Type.Unknown()` serializes as pass-through, unlike a typed object
// schema which would silently strip undeclared fields) rather than modelled strictly,
// so the exemplar's schema-first validation covers the querystring and envelope shape
// without risking silent field loss on either response path.
const listingsSearchResponseSchema = Type.Object({
  data: Type.Array(Type.Unknown()),
  facets: Type.Record(Type.String(), Type.Unknown()),
  pagination: Type.Object({
    page: Type.Number(),
    perPage: Type.Number(),
    total: Type.Number(),
    totalPages: Type.Number(),
  }),
})

export const listingRoutes: FastifyPluginAsyncTypebox<ListingsPluginOptions> = async (app, { listings, search, facets, queueFactory }) => {
  const recallsQueue = queueFactory.createQueue(QUEUES.NHTSA_RECALLS)
  const complaintsQueue = queueFactory.createQueue(QUEUES.NHTSA_COMPLAINTS)
  const safetyRatingsQueue = queueFactory.createQueue(QUEUES.NHTSA_SAFETY_RATINGS)
  const investigationsQueue = queueFactory.createQueue(QUEUES.NHTSA_INVESTIGATIONS)
  const manufacturerCommunicationsQueue = queueFactory.createQueue(QUEUES.NHTSA_MANUFACTURER_COMMUNICATIONS)

  app.get('/facets', { schema: { querystring: filterQuerySchema, response: { 200: facetsResponseSchema } } }, async (req, reply) => {
    const q = req.query
    try {
      const result = await facets.getFacets({
        q: q.q,
        make: parseArr(q.make),
        model: parseArr(q.model),
        trim: parseArr(q.trim),
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
        sellerType: parseArr(q.sellerType),
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
          trimBreakdown: [],
          stateBreakdown: [],
          conditionBreakdown: [],
          conversionBreakdown: [],
          colorBreakdown: [],
          rampTypeBreakdown: [],
          sellerTypeBreakdown: [],
          conversionBrandBreakdown: [],
          wavFeatureCounts: {},
        },
      })
    }
  })

  app.get('/', { schema: { querystring: filterQuerySchema, response: { 200: listingsSearchResponseSchema, 503: searchUnavailableResponseSchema } } }, async (req, reply) => {
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
        trim: parseArr(q.trim),
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
        sellerType: parseArr(q.sellerType),
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
      // Meilisearch unavailable — return an explicit degraded response rather
      // than silently dropping requested filters (#669, D3). A repository
      // fallback here would either ignore filters (wrong results presented
      // as correct) or require re-implementing full filter/facet semantics
      // against Postgres (a second search engine to keep in sync). An honest
      // 503 lets the client render a clear degraded state instead.
      req.log.warn(err, '[listings] Meilisearch unavailable, returning degraded response')
      return reply.code(503).send({
        error: {
          code: 'SEARCH_UNAVAILABLE',
          message: 'Search is temporarily unavailable. Please try again shortly.',
        },
      })
    }
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      const listing = await listings.findById(req.params.id)
      if (!listing) return reply.notFound('Listing not found')
      if (!listing.source) return reply.internalServerError('Listing source not found')

      const [crossListings, unresolvedReportCount] = await Promise.all([
        listing.vehicleId
          ? listings.findCrossListingsByVehicleId(listing.vehicleId, listing.id)
          : Promise.resolve([]),
        listings.countUnresolvedReports(listing.id),
      ])

      return reply.send({
        data: toListingDetailResponse(
          listing as ListingWithRequiredSource,
          crossListings.map(toCrossListingResponse),
          { unresolvedCount: unresolvedReportCount, flagged: unresolvedReportCount >= 3 },
        ),
      })
    } catch (err) {
      req.log.error(err, '[listings/:id] failed to fetch listing')
      return reply.internalServerError('Failed to fetch listing')
    }
  })

  app.post<{ Params: { id: string }; Body: { reportType: ListingReportType; notes?: string } }>(
    '/:id/reports',
    {
      schema: {
        body: createListingReportBodySchema,
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const listing = await listings.findByIdForSafety(req.params.id)
      if (!listing) return reply.notFound('Listing not found')

      const report = await listings.createListingReport({
        listingId: listing.id,
        reportType: req.body.reportType,
        ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
      })

      return reply.code(201).send({ data: report })
    },
  )

  app.get<{ Params: { id: string } }>('/:id/safety', async (req, reply) => {
    const listing = await listings.findByIdForSafety(req.params.id)
    if (!listing) return reply.notFound('Listing not found')
    if (!listing.vehicleModelId) return reply.send({ data: { vehicleModel: null, recalls: [], complaints: [], safetyRatings: [], safetyFreshnessDate: null, investigations: [], manufacturerCommunications: [] } })

    const vehicleModel = await listings.findVehicleModelWithSafetyData(listing.vehicleModelId)

    const rawRecalls = vehicleModel?.recalls ?? []
    const rawComplaints = vehicleModel?.complaints ?? []
    const rawRatings = vehicleModel?.safetyRatings ?? []
    const investigations = vehicleModel?.investigations ?? []
    const manufacturerCommunications = vehicleModel?.manufacturerCommunications ?? []

    // Freshness date: the most recent refreshedAt across every NHTSA record
    // type we sync (recalls, complaints, ratings, investigations, TSBs), or
    // null when none of them have ever been synced. Using only safety-rating
    // freshness left the banner permanently stuck on "unknown" for any
    // vehicle model NHTSA has no 5-star rating for (most WAV conversions) —
    // recalls/complaints/investigations/TSBs can be freshly synced while
    // ratings stay empty.
    const allRefreshedAt: Date[] = [
      ...rawRecalls.map((r) => r.refreshedAt),
      ...rawComplaints.map((c) => c.refreshedAt),
      ...rawRatings.map((r) => r.refreshedAt).filter((d): d is Date => d !== null),
      ...investigations.map((i) => i.refreshedAt),
      ...manufacturerCommunications.map((c) => c.refreshedAt),
    ]
    const safetyFreshnessDate = allRefreshedAt.length === 0
      ? null
      : new Date(Math.max(...allRefreshedAt.map((d) => d.getTime()))).toISOString()

    // Strip refreshedAt from each record — it is already aggregated into safetyFreshnessDate
    const recalls = rawRecalls.map(({ refreshedAt: _unused, ...r }) => ({ ...r, status: normalizeRecallStatus(r.remedy) }))
    const complaints = rawComplaints.map(({ refreshedAt: _unused, ...rest }) => rest)
    const safetyRatings = rawRatings.map(({ refreshedAt: _unused, ...rest }) => rest)

    return reply.send({
      data: {
        vehicleModel: vehicleModel
          ? { id: vehicleModel.id, make: vehicleModel.make, model: vehicleModel.model, year: vehicleModel.year, trim: vehicleModel.trim, bodyType: vehicleModel.bodyType }
          : null,
        recalls,
        complaints,
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
