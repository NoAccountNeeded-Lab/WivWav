import type { FastifyPluginAsync } from 'fastify'
import { fetchSentryIssues, type SentryIssuesClientOptions } from '../services/sentry-issues-client.js'

type InternalSentryIssuesPluginOptions = SentryIssuesClientOptions

/**
 * GET /internal/v1/sentry/issues
 *
 * Read-only proxy for recent unresolved Sentry issue summaries — see
 * `services/sentry-issues-client.ts` for the fetch/normalisation logic this
 * route shares with `routes/admin-problem-aggregate.ts` (issue #892), so the
 * two never fork the Sentry-to-`SentryIssueSummary` mapping.
 */
export const internalSentryIssuesRoutes: FastifyPluginAsync<InternalSentryIssuesPluginOptions> = async (
  app,
  options,
) => {
  app.get('/', async (_req, reply) => {
    const result = await fetchSentryIssues(options)
    return reply.send({ data: result })
  })
}
