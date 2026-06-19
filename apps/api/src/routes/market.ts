import type { FastifyPluginAsync } from 'fastify'
import type { MarketRepository } from '../repositories/index.js'

interface MarketPluginOptions {
  market: MarketRepository
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

export const marketRoutes: FastifyPluginAsync<MarketPluginOptions> = async (app, { market }) => {
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
}
