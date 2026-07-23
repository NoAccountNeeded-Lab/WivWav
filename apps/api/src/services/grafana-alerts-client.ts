import type { GrafanaAlertInstance } from '@wivwav/types'

export interface GrafanaAlertsClientOptions {
  grafanaUrl: string
  /** Optional — local dev's Grafana runs with anonymous admin access
   *  (see docker-compose.yml), so this is only required against a
   *  Grafana instance with auth enabled. */
  grafanaApiToken: string | undefined
}

export interface GrafanaAlertsFetchResult {
  alerts: GrafanaAlertInstance[]
  unavailable: boolean
}

/** Shape of one entry from Grafana's alertmanager-compatible API:
 *  `GET /api/alertmanager/grafana/api/v2/alerts`. Only the fields this
 *  client consumes are declared. */
interface GrafanaAlertmanagerAlert {
  labels?: Record<string, string>
  annotations?: Record<string, string>
  status?: { state?: string }
  startsAt?: string
}

/**
 * Read-only fetch of current Grafana alert-instance state against the rules
 * provisioned in `docker/grafana/provisioning/alerting/wivwav-alert-rules.yaml`
 * (issue #890, federated into the problem aggregate downstream). Never
 * throws: an unreachable or erroring Grafana backend returns
 * `{ alerts: [], unavailable: true }` rather than rejecting.
 *
 * Shared by `routes/internal-grafana-alerts.ts` (the server-to-server proxy)
 * and `routes/admin-problem-aggregate.ts` (issue #892, which needs the same
 * data server-side rather than round-tripping through that internal route)
 * so the two never fork the Grafana-to-`GrafanaAlertInstance` mapping.
 */
export async function fetchGrafanaAlerts({ grafanaUrl, grafanaApiToken }: GrafanaAlertsClientOptions): Promise<GrafanaAlertsFetchResult> {
  let res: Response
  try {
    res = await fetch(`${grafanaUrl}/api/alertmanager/grafana/api/v2/alerts?active=true`, {
      signal: AbortSignal.timeout(8_000),
      headers: grafanaApiToken ? { Authorization: `Bearer ${grafanaApiToken}` } : {},
    })
  } catch {
    return { alerts: [], unavailable: true }
  }

  if (!res.ok) {
    return { alerts: [], unavailable: true }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { alerts: [], unavailable: true }
  }

  if (!Array.isArray(body)) {
    return { alerts: [], unavailable: true }
  }

  return { alerts: (body as GrafanaAlertmanagerAlert[]).map(toAlertInstance), unavailable: false }
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
