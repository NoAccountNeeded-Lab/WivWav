import type { FastifyPluginAsync } from 'fastify'
import type { ConversionBrandRepository } from '../repositories/conversion-brand-repository.js'

interface ConversionBrandsPluginOptions {
  conversionBrands: ConversionBrandRepository
}

export const conversionBrandRoutes: FastifyPluginAsync<ConversionBrandsPluginOptions> = async (
  app,
  { conversionBrands },
) => {
  app.get('/', async (_req, reply) => {
    try {
      const brands = await conversionBrands.findAll()
      return reply.send({ data: brands })
    } catch (err) {
      app.log.error(err, 'Failed to fetch conversion brands')
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch conversion brands' },
      })
    }
  })

  app.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    try {
      const brand = await conversionBrands.findBySlug(req.params.slug)
      if (!brand) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Conversion brand not found' },
        })
      }
      return reply.send({ data: brand })
    } catch (err) {
      app.log.error(err, 'Failed to fetch conversion brand')
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch conversion brand' },
      })
    }
  })
}
