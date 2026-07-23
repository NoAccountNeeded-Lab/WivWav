import type {
  GrafanaAlertInstance,
  Problem,
  ProblemAggregate,
  ProblemAggregateRequest,
  SentryIssueSummary,
} from '@wivwav/types'
import { computeAttentionSnapshot } from './attention-snapshot.js'

/**
 * Federates the shared domain snapshot (`computeAttentionSnapshot`, #774)
 * with Grafana alert-instance state and Sentry issue summaries into one
 * typed `Problem[]` (issue #890, child of #758).
 *
 * Like `computeAttentionSnapshot`, this never fetches anything itself and
 * never throws — a `grafana`/`sentry` input marked `unavailable` simply
 * contributes no problems from that source and is reflected in
 * `availability` instead. Domain conditions are never recomputed here: this
 * function delegates straight to `computeAttentionSnapshot` so the ops
 * overview's Attention panel and this aggregate can never fork condition
 * logic into two implementations.
 */
export function computeProblemAggregate(request: ProblemAggregateRequest): ProblemAggregate {
  const snapshot = computeAttentionSnapshot(request.domain)

  const domainProblems: Problem[] = snapshot.conditions.map(condition => ({
    fingerprint: `domain:${condition.code}:${condition.evidenceId}`,
    source: 'domain',
    severity: condition.severity,
    detail: condition.detail,
    evidenceId: condition.evidenceId,
    href: null,
    firstSeen: null,
    lastSeen: null,
    occurrenceCount: null,
  }))

  const grafanaProblems = request.grafana.unavailable
    ? []
    : grafanaAlertProblems(request.grafana.data ?? [])

  const sentryProblems = request.sentry.unavailable
    ? []
    : sentryIssueProblems(request.sentry.data ?? [])

  return {
    problems: [...domainProblems, ...grafanaProblems, ...sentryProblems],
    availability: {
      ...snapshot.signalAvailability,
      grafana: request.grafana.unavailable ? 'unavailable' : 'available',
      sentry: request.sentry.unavailable ? 'unavailable' : 'available',
    },
  }
}

function grafanaAlertProblems(alerts: GrafanaAlertInstance[]): Problem[] {
  return alerts
    .filter(alert => alert.state === 'alerting' || alert.state === 'pending')
    .map(alert => {
      const evidenceId = `grafana:${alert.ruleUid ?? alert.alertname}`
      return {
        fingerprint: evidenceId,
        source: 'grafana',
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        detail: alert.summary ?? `${alert.alertname} is ${alert.state}`,
        evidenceId,
        // No per-alert URL available from Grafana's alertmanager-compatible
        // API without also threading grafanaUrl through this pure function;
        // consumers fall back to a generic infra surface (e.g. `/status`).
        href: null,
        firstSeen: alert.activeAt,
        lastSeen: alert.activeAt,
        occurrenceCount: null,
      }
    })
}

function sentryIssueProblems(issues: SentryIssueSummary[]): Problem[] {
  return issues.map(issue => {
    const evidenceId = `sentry:${issue.id}`
    return {
      fingerprint: evidenceId,
      source: 'sentry',
      severity: issue.level === 'fatal' || issue.level === 'error' ? 'critical' : 'warning',
      detail: issue.culprit ? `${issue.title} — ${issue.culprit}` : issue.title,
      evidenceId,
      // Sentry's own issue page is the accurate "fix surface" deep link
      // (issue #892's acceptance criterion) — already fetched, just wasn't
      // previously carried through onto `Problem`.
      href: issue.permalink,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      occurrenceCount: issue.count,
    }
  })
}
