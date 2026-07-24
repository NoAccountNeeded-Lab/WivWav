import type { FastifyPluginAsync } from 'fastify'
import { fetchGrafanaAlerts, type GrafanaAlertsClientOptions } from '../services/grafana-alerts-client.js'

type InternalGrafanaAlertsPluginOptions = GrafanaAlertsClientOptions

/**
 * GET /internal/v1/grafana/alerts
 *
 * Read-only proxy for current Grafana alert-instance state — see
 * `services/grafana-alerts-client.ts` for the fetch/normalisation logic this
 * route shares with `routes/internal-ops-problem-aggregate.ts` (issue #892), so the
 * two never fork the Grafana-to-`GrafanaAlertInstance` mapping.
 */
export const internalGrafanaAlertsRoutes: FastifyPluginAsync<InternalGrafanaAlertsPluginOptions> = async (
  app,
  options,
) => {
  app.get('/', async (_req, reply) => {
    const result = await fetchGrafanaAlerts(options)
    return reply.send({ data: result })
  })
}
