import type { AttentionSeverity, AttentionSignalAvailability, AttentionSnapshotRequest } from './attention-snapshot.js'

/**
 * Federates the shared domain snapshot (`computeAttentionSnapshot`, #774)
 * with Grafana alert-instance state and Sentry issue summaries into one
 * typed `Problem[]` (issue #890, child of #758's unified problem triage).
 *
 * `computeProblemAggregate` in `apps/api/src/domain/problem-aggregate.ts` is
 * the single implementation of this federation — it never fetches anything
 * itself and never throws; an unreachable Grafana or Sentry backend simply
 * contributes zero problems from that source and is reflected in
 * `availability` instead, mirroring `AttentionSignalAvailability`.
 *
 * No persistence here — acknowledgement state and first-seen/last-seen
 * tracking for domain-only problems are a separate child issue of #758.
 */

export type ProblemSource = 'domain' | 'grafana' | 'sentry'

export interface Problem {
  /** Stable identity for this problem, unique within its source:
   *  `domain:${code}:${evidenceId}`, `grafana:${rule.uid}`, `sentry:${issue.id}`. */
  fingerprint: string
  source: ProblemSource
  severity: AttentionSeverity
  /** Factual, data-derived explanation — not styled display copy. */
  detail: string
  /** Stable reference to the evidence backing this problem; consumers
   *  resolve this to a human label/deep-link using data they already hold. */
  evidenceId: string
  /**
   * Direct link to the problem's own fix surface, where the source can
   * provide one (issue #892's "working deep link" acceptance criterion) —
   * currently only Sentry's `permalink`. `null` for domain and Grafana
   * problems, whose consumers derive a link from `source`/`evidenceId`
   * against surfaces they already know about (e.g. `/ops/sources`,
   * `/ops/queues`) instead.
   */
  href: string | null
  /** ISO timestamp this problem was first observed, where the source tracks
   *  it (Grafana/Sentry); null for domain conditions, which are recomputed
   *  fresh on every call and carry no history in this issue's scope. */
  firstSeen: string | null
  /** ISO timestamp this problem was last observed, where the source tracks it. */
  lastSeen: string | null
  /** Occurrence/event count, where the source tracks it (e.g. Sentry). */
  occurrenceCount: number | null
}

/** Extends `AttentionSignalAvailability` (health/bullmq/db/loki) with the
 *  two additional backends this aggregate federates. */
export type ProblemSignalAvailability = AttentionSignalAvailability & {
  grafana: 'available' | 'unavailable'
  sentry: 'available' | 'unavailable'
}

export interface ProblemAggregate {
  problems: Problem[]
  availability: ProblemSignalAvailability
}

/**
 * A `Problem` enriched with the persisted lifecycle/acknowledgement state
 * `POST /admin/problem-aggregate` (issue #892) merges in from
 * `ops_problem_state` after each aggregation pass: `firstSeen`/`lastSeen`/
 * `occurrenceCount` are always populated here (never `null`, unlike the raw
 * `Problem` a domain-only condition otherwise carries), and acknowledgement
 * is added. This is the shape both the ops overview's Attention panel and
 * `/ops/problems` render from — see `apps/ops/src/app/ops/use-problem-aggregate.ts`.
 */
export interface ProblemState extends Problem {
  acknowledgedAt: string | null
  acknowledgedBy: string | null
}

export interface ProblemAggregateResponse {
  problems: ProblemState[]
  availability: ProblemSignalAvailability
}

// ── Grafana ──────────────────────────────────────────────────────────────

/** One alert instance's current state, as reported by Grafana's
 *  alertmanager-compatible API (`GET /api/alertmanager/grafana/api/v2/alerts`)
 *  against the rules provisioned in
 *  `docker/grafana/provisioning/alerting/wivwav-alert-rules.yaml`. */
export interface GrafanaAlertInstance {
  /** Rule UID from the provisioned alert-rule YAML, when Grafana reports it
   *  as a label; null if the alert's labels don't carry it. */
  ruleUid: string | null
  alertname: string
  /** Grafana alert-instance state: 'alerting' (firing) or 'pending' are the
   *  only states this aggregate treats as a problem; other states
   *  (e.g. resolved instances no longer returned by the active-alerts query)
   *  contribute nothing. */
  state: 'alerting' | 'pending' | string
  severity: string | null
  summary: string | null
  /** ISO timestamp the alert instance became active. */
  activeAt: string | null
}

export interface GrafanaAlertsResourceInput {
  data: GrafanaAlertInstance[] | null
  unavailable: boolean
}

// ── Sentry ───────────────────────────────────────────────────────────────

/** One issue summary from Sentry's issues API. */
export interface SentryIssueSummary {
  id: string
  title: string
  culprit: string | null
  level: string
  count: number
  firstSeen: string
  lastSeen: string
  permalink: string
}

export interface SentryIssuesResourceInput {
  data: SentryIssueSummary[] | null
  unavailable: boolean
}

// ── Input contract ───────────────────────────────────────────────────────

export interface ProblemAggregateRequest {
  /** Same "caller reports state, function never fetches" pattern as
   *  `computeAttentionSnapshot` — reused directly, not re-implemented. */
  domain: AttentionSnapshotRequest
  grafana: GrafanaAlertsResourceInput
  sentry: SentryIssuesResourceInput
}
