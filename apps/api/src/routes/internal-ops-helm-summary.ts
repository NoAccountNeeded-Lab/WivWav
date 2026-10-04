import type { FastifyPluginAsync } from 'fastify'
import type { IndexStats, Meilisearch } from 'meilisearch'
import { INDEX_NAME } from '@wivwav/search'
import type { ListingRepository } from '../repositories/index.js'
import { collectHelmSummary } from '../services/helm-summary.js'

interface InternalOpsHelmSummaryPluginOptions {
  listings: Pick<ListingRepository, 'countStored' | 'countObservedActive' | 'getPublicationCountsBySource'>
  meili: Meilisearch
}

/**
 * GET /internal/ops/helm-summary (issue #1071)
 *
 * Independent listing-row/document counts for the /helm inventory view.
 * Active and eligible reuse the repository's publication-aware logic
 * (`countObservedActive`, `getPublicationCountsBySource`) so they match
 * `/admin/listing-refresh/status`; indexed is the live Meilisearch document
 * count. Each reading fails on its own as `null`/`unavailable`, never zero.
 * Mounted under `/internal/ops/*` behind the shared bearer guard (see `app.ts`).
 */
export const internalOpsHelmSummaryRoutes: FastifyPluginAsync<InternalOpsHelmSummaryPluginOptions> = async (
  app,
  { listings, meili },
) => {
  app.get('/', async (_req, reply) => {
    const data = await collectHelmSummary({
      countStored: () => listings.countStored(),
      countActive: () => listings.countObservedActive(),
      countEligible: async () => {
        const rows = await listings.getPublicationCountsBySource()
        return rows.reduce((sum, row) => sum + row.eligibleActive, 0)
      },
      // Index.getStats() takes no signal; the same GET via httpRequest does.
      countIndexed: async signal =>
        (
          await meili.httpRequest.get<IndexStats>({
            path: `indexes/${INDEX_NAME}/stats`,
            extraRequestInit: { signal },
          })
        ).numberOfDocuments,
    })
    return reply.send({ data })
  })
}
