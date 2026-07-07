import type { FastifyPluginAsync } from 'fastify'
import type { MarketRepository, ApiKeyRepository, MarketTrendInterval } from '../repositories/index.js'
import { resolveApiKeyTier, tierAtLeast } from '../services/api-key-tier.js'

interface MarketPluginOptions {
  market: MarketRepository
  apiKeys: ApiKeyRepository
}

interface PricingQuery {
  make: string
  model: string
  year?: number
  conversionType?: string
}

const pricingQuerySchema = {
  type: 'object',
  required: ['make', 'model'],
  properties: {
    make: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    year: { type: 'integer', minimum: 1980, maximum: 2030 },
    conversionType: { type: 'string', enum: ['rear_entry', 'side_entry', 'unknown'] },
  },
  additionalProperties: false,
} as const

interface TrendsQuery {
  make: string
  model: string
  interval?: MarketTrendInterval
  from?: string
  to?: string
}

const trendsQuerySchema = {
  type: 'object',
  required: ['make', 'model'],
  properties: {
    make: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    interval: { type: 'string', enum: ['week', 'month'], default: 'month' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const

const DEFAULT_TRENDS_LOOKBACK_DAYS = 180
// Caps the `from`..`to` span so an unbounded caller-supplied range can't force
// getTrends' generate_series to materialize an unbounded number of buckets
// (each bucket cross-joins representative_listings in the price_points CTE).
const MAX_TRENDS_SPAN_DAYS = 1826 // ~5 years

export const marketRoutes: FastifyPluginAsync<MarketPluginOptions> = async (app, { market, apiKeys }) => {
  app.get<{ Querystring: PricingQuery }>('/pricing', { schema: { querystring: pricingQuerySchema } }, async (req, reply) => {
    const { make, model } = req.query
    const year = req.query.year ?? null
    const conversionType = req.query.conversionType ?? null

    try {
      const stats = await market.getPricingStats(make, model, year, conversionType)
      const { count, dropTotal, dropCount } = stats

      return reply.send({
        data: {
          spec: {
            make,
            model,
            ...(year !== null && { year }),
            ...(conversionType !== null && { conversionType }),
          },
          count,
          priceCents: count === 0
            ? null
            : {
                p10: Math.round(stats.p10 ?? 0),
                p25: Math.round(stats.p25 ?? 0),
                p50: Math.round(stats.p50 ?? 0),
                p75: Math.round(stats.p75 ?? 0),
                p90: Math.round(stats.p90 ?? 0),
              },
          medianMileage: stats.medianMileage != null ? Math.round(stats.medianMileage) : null,
          medianDaysListed: stats.medianDaysListed != null ? Math.round(stats.medianDaysListed) : null,
          priceDropRate: dropTotal > 0 ? Math.round((dropCount / dropTotal) * 100) / 100 : null,
          priceDropCount: dropCount,
        },
      })
    } catch (err) {
      req.log.error(err, 'Failed to fetch pricing data')
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pricing data' } })
    }
  })

  app.get('/popular', async (_req, reply) => {
    try {
      const popular = await market.getPopular()
      return reply.send({ data: popular })
    } catch (err) {
      app.log.error(err, 'Failed to fetch popular listings data')
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch popular listings data' } })
    }
  })

  /**
   * GET /v1/market/trends?make=&model=&interval=week|month&from=&to=
   *
   * Time-bucketed median price, active inventory count, and average
   * days-to-gone for a make/model. `interval` defaults to `month`; `from`
   * defaults to 180 days before `to`, and `to` defaults to now. PRO+ only —
   * returns 403 `upgrade_required` for FREE-tier callers.
   *
   * Example response:
   * ```json
   * { "data": { "make": "Toyota", "model": "Sienna", "interval": "month", "points": [
   *   { "bucketStart": "2026-05-01T00:00:00.000Z", "medianPriceCents": 4500000,
   *     "activeInventoryCount": 12, "avgDaysToGone": 34.5 }
   * ] } }
   * ```
   */
  app.get<{ Querystring: TrendsQuery }>('/trends', { schema: { querystring: trendsQuerySchema } }, async (req, reply) => {
    const tier = await resolveApiKeyTier(apiKeys, req.headers)
    if (!tierAtLeast(tier, 'PRO')) {
      return reply.code(403).send({
        error: { code: 'upgrade_required', message: 'GET /v1/market/trends requires a PRO or higher API key' },
      })
    }

    const { make, model } = req.query
    const interval: MarketTrendInterval = req.query.interval ?? 'month'
    const to = req.query.to ? new Date(req.query.to) : new Date()
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getTime() - DEFAULT_TRENDS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

    if (from.getTime() > to.getTime()) {
      return reply.badRequest('`from` must be before `to`')
    }
    const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    if (spanDays > MAX_TRENDS_SPAN_DAYS) {
      return reply.badRequest(`\`from\`..\`to\` span cannot exceed ${MAX_TRENDS_SPAN_DAYS} days`)
    }

    try {
      const points = await market.getTrends(make, model, interval, from, to)
      return reply.send({
        data: {
          make,
          model,
          interval,
          points: points.map((p) => ({
            bucketStart: p.bucketStart.toISOString(),
            medianPriceCents: p.medianPriceCents,
            activeInventoryCount: p.activeInventoryCount,
            avgDaysToGone: p.avgDaysToGone,
          })),
        },
      })
    } catch (err) {
      req.log.error(err, 'Failed to fetch market trends')
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch market trends' } })
    }
  })
}
