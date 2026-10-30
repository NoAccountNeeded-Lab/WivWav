import type { FastifyPluginAsync } from 'fastify'
import type { QueueAdapter } from '@wivwav/queue'
import type { ListingRepository, ScraperRunRepository, SourceRepository } from '../repositories/index.js'
import { buildListingRefreshStatus } from '../services/listing-refresh-status.js'

interface AdminListingRefreshOptions {
  listings: ListingRepository
  sources: SourceRepository
  scraperRuns: ScraperRunRepository
  queues: Map<string, QueueAdapter>
}

export const adminListingRefreshRoutes: FastifyPluginAsync<AdminListingRefreshOptions> = async (
  app,
  { listings, sources, scraperRuns, queues },
) => {
  // GET /internal/ops/listing-refresh/status — aggregate status for the guided refresh workflow
  app.get('/listing-refresh/status', async (_req, reply) => {
    try {
      const data = await buildListingRefreshStatus({ sources, scraperRuns, listings, queues })
      return reply.send({ data })
    } catch (err) {
      app.log.error(err, 'Listing refresh status unavailable')
      return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Listing refresh status is unavailable' } })
    }
  })
}
