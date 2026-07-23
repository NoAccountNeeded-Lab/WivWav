import type { FastifyPluginAsync } from 'fastify'
import type { GrafanaAlertInstance } from '@wivwav/types'

interface AdminGrafanaAlertsPluginOptions {
  grafanaUrl: string
  /** Optional — local dev's Grafana runs with anonymous admin access
   *  (see docker-compose.yml), so this is only required against a
   *  Grafana instance with auth enabled. */
  grafanaApiToken: string | undefined
}

/** Shape of one entry from Grafana's alertmanager-compatible API:
 *  `GET /api/alertmanager/grafana/api/v2/alerts`. Only the fields this
 *  route consumes are declared. */
interface GrafanaAlertmanagerAlert {
  labels?: Record<string, string>
  annotations?: Record<string, string>
  status?: { state?: string }
  startsAt?: string
}

/**
 * GET /admin/grafana/alerts
 *
 * Read-only proxy for current Grafana alert-instance state against the
 * rules provisioned in `docker/grafana/provisioning/alerting/wivwav-alert-rules.yaml`
 * (issue #890, federated into the problem aggregate downstream). Never
 * throws: an unreachable or erroring Grafana backend returns
 * `{ data: { alerts: [], unavailable: true } }` rather than a non-2xx
 * response, mirroring `signalAvailability` in `attention-snapshot.ts`.
 */
export const adminGrafanaAlertsRoutes: FastifyPluginAsync<AdminGrafanaAlertsPluginOptions> = async (
  app,
  { grafanaUrl, grafanaApiToken },
) => {
  app.get('/', async (_req, reply) => {
    let res: Response
    try {
      res = await fetch(`${grafanaUrl}/api/alertmanager/grafana/api/v2/alerts?active=true`, {
        signal: AbortSignal.timeout(8_000),
        headers: grafanaApiToken ? { Authorization: `Bearer ${grafanaApiToken}` } : {},
      })
    } catch {
      return reply.send({ data: { alerts: [], unavailable: true } })
    }

    if (!res.ok) {
      return reply.send({ data: { alerts: [], unavailable: true } })
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return reply.send({ data: { alerts: [], unavailable: true } })
    }

    if (!Array.isArray(body)) {
      return reply.send({ data: { alerts: [], unavailable: true } })
    }

    const alerts: GrafanaAlertInstance[] = (body as GrafanaAlertmanagerAlert[]).map(toAlertInstance)
    return reply.send({ data: { alerts, unavailable: false } })
  })
}

function toAlertInstance(alert: GrafanaAlertmanagerAlert): GrafanaAlertInstance {
  const labels = alert.labels ?? {}
  const annotations = alert.annotations ?? {}
  const state = alert.status?.state ?? 'unknown'

  return {
    // Grafana's provisioned rules carry their YAML `uid` through as the
    // `__alert_rule_uid__` label on each instance.
    ruleUid: labels.__alert_rule_uid__ ?? null,
    alertname: labels.alertname ?? 'unknown',
    state: state === 'active' ? 'alerting' : state === 'suppressed' ? 'pending' : state,
    severity: labels.severity ?? null,
    summary: annotations.summary ?? null,
    activeAt: alert.startsAt ?? null,
  }
}
