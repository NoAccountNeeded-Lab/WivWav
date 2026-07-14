import type { FastifyPluginAsync } from 'fastify'
import type { DealerRepository, DealerListingStatusFilter, ApiKeyRepository } from '../repositories/index.js'
import { resolveApiKeyTier, tierAtLeast } from '../services/api-key-tier.js'
import { getResolvedApiKey } from '../plugins/api-key-auth.js'

interface DealersPluginOptions {
  dealers: DealerRepository
  apiKeys: ApiKeyRepository
}

interface ListingsQuery {
  status?: string
  skip?: number
  take?: number
}

const listingsQuerySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['active', 'gone', 'all'] },
    skip: { type: 'integer', minimum: 0, default: 0 },
    take: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
  additionalProperties: false,
} as const

interface ReviewsQuery {
  skip?: number
  take?: number
}

const reviewsQuerySchema = {
  type: 'object',
  properties: {
    skip: { type: 'integer', minimum: 0, default: 0 },
    take: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
  additionalProperties: false,
} as const

export const dealerRoutes: FastifyPluginAsync<DealersPluginOptions> = async (app, { dealers, apiKeys }) => {
  /**
   * GET /v1/dealers/:id
   *
   * Dealer profile: name, zip, rating, review count, and hours. FREE.
   *
   * Example response:
   * ```json
   * { "data": { "id": "dp1", "name": "Acme Vans", "zip": "60601",
   *   "rating": 4.6, "reviewCount": 42, "hours": { "mon": "9-6" } } }
   * ```
   */
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const profile = await dealers.findProfile(req.params.id)
    if (!profile) return reply.notFound('Dealer not found')
    return reply.send({ data: profile })
  })

  /**
   * GET /v1/dealers/:id/listings?status=active|gone|all&skip=&take=
   *
   * Paginated listings for a dealer. `status=active` (the default) is
   * FREE. `status=gone` and `status=all` are PRO+ only and return 403
   * `upgrade_required` for FREE-tier callers.
   *
   * Example response:
   * ```json
   * { "data": { "listings": [
   *   { "id": "l1", "make": "Toyota", "model": "Sienna", "year": 2019,
   *     "priceCents": 4200000, "mileage": 41000, "status": "gone",
   *     "listedAt": "2026-03-01T00:00:00.000Z",
   *     "goneAt": "2026-04-15T00:00:00.000Z", "soldAt": null }
   * ], "pagination": { "skip": 0, "take": 25, "total": 1 } } }
   * ```
   */
  app.get<{ Params: { id: string }; Querystring: ListingsQuery }>(
    '/:id/listings',
    { schema: { querystring: listingsQuerySchema } },
    async (req, reply) => {
      const profile = await dealers.findProfile(req.params.id)
      if (!profile) return reply.notFound('Dealer not found')

      const status: DealerListingStatusFilter = (req.query.status as DealerListingStatusFilter | undefined) ?? 'active'
      if (status !== 'active') {
        // Prefer the identity plugins/api-key-auth.ts already resolved for
        // this request (correctly reflects the INTERNAL_API_SECRET bypass as
        // ENTERPRISE) — falls back to re-resolving from headers only when
        // this route is exercised without that app-level hook (e.g. isolated tests).
        const tier = getResolvedApiKey(req)?.tier ?? (await resolveApiKeyTier(apiKeys, req.headers))
        if (!tierAtLeast(tier, 'PRO')) {
          return reply.code(403).send({
            error: { code: 'upgrade_required', message: `GET /v1/dealers/:id/listings?status=${status} requires a PRO or higher API key` },
          })
        }
      }

      const skip = req.query.skip ?? 0
      const take = req.query.take ?? 25
      const [rows, total] = await Promise.all([
        dealers.findListings(req.params.id, status, skip, take),
        dealers.countListings(req.params.id, status),
      ])

      return reply.send({
        data: {
          listings: rows.map((r) => ({
            id: r.id,
            make: r.make,
            model: r.model,
            year: r.year,
            priceCents: r.priceCents,
            mileage: r.mileage,
            status: r.status,
            listedAt: r.listedAt.toISOString(),
            goneAt: r.goneAt ? r.goneAt.toISOString() : null,
            soldAt: r.soldAt ? r.soldAt.toISOString() : null,
          })),
          pagination: { skip, take, total },
        },
      })
    },
  )

  /**
   * GET /v1/dealers/:id/reviews?skip=&take=
   *
   * Paginated dealer reviews, newest first. FREE.
   *
   * Example response:
   * ```json
   * { "data": { "reviews": [
   *   { "id": "r1", "authorName": "J. Smith", "rating": 5,
   *     "text": "Great experience", "publishedAt": "2026-06-01T00:00:00.000Z",
   *     "source": "google" }
   * ], "pagination": { "skip": 0, "take": 25, "total": 1 } } }
   * ```
   */
  app.get<{ Params: { id: string }; Querystring: ReviewsQuery }>(
    '/:id/reviews',
    { schema: { querystring: reviewsQuerySchema } },
    async (req, reply) => {
      const profile = await dealers.findProfile(req.params.id)
      if (!profile) return reply.notFound('Dealer not found')

      const skip = req.query.skip ?? 0
      const take = req.query.take ?? 25
      const [rows, total] = await Promise.all([
        dealers.findReviews(req.params.id, skip, take),
        dealers.countReviews(req.params.id),
      ])

      return reply.send({
        data: {
          reviews: rows.map((r) => ({
            id: r.id,
            authorName: r.authorName,
            rating: r.rating,
            text: r.text,
            publishedAt: r.publishedAt.toISOString(),
            source: r.source,
          })),
          pagination: { skip, take, total },
        },
      })
    },
  )
}
