import type { FastifyPluginAsync } from 'fastify'
import type { NmeaDealerRepository } from '../repositories/nmea-dealer-repository.js'

interface NmeaDealersPluginOptions {
  nmeaDealers: NmeaDealerRepository
}

const DEFAULT_RADIUS_MILES = 100
const MAX_RADIUS_MILES = 500
const DEFAULT_LIMIT = 50

export const nmeaDealerRoutes: FastifyPluginAsync<NmeaDealersPluginOptions> = async (
  app,
  { nmeaDealers },
) => {
  app.get<{
    Querystring: { lat?: string; lng?: string; radius?: string }
  }>('/', async (req, reply) => {
    const { lat: latStr, lng: lngStr, radius: radiusStr } = req.query

    if (latStr === undefined || lngStr === undefined) {
      return reply.code(400).send({
        error: { code: 'MISSING_PARAMS', message: '`lat` and `lng` query parameters are required' },
      })
    }

    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (!isFinite(lat) || lat < -90 || lat > 90) {
      return reply.code(400).send({
        error: { code: 'INVALID_PARAM', message: '`lat` must be a number between -90 and 90' },
      })
    }
    if (!isFinite(lng) || lng < -180 || lng > 180) {
      return reply.code(400).send({
        error: { code: 'INVALID_PARAM', message: '`lng` must be a number between -180 and 180' },
      })
    }

    const radius = radiusStr !== undefined
      ? Math.min(Math.max(parseFloat(radiusStr) || DEFAULT_RADIUS_MILES, 1), MAX_RADIUS_MILES)
      : DEFAULT_RADIUS_MILES

    try {
      const dealers = await nmeaDealers.findNearby(lat, lng, radius, DEFAULT_LIMIT)
      return reply.send({ data: dealers })
    } catch (err) {
      app.log.error(err, 'Failed to fetch NMEA dealers')
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch NMEA dealers' },
      })
    }
  })
}
