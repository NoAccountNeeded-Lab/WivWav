import type { HealthResponse } from './api.js'

/**
 * Shared contract for the domain-level "what is currently wrong" computation
 * (issue #774, D4 from #757/#758). One implementation — `computeAttentionSnapshot`
 * in `apps/api/src/domain/attention-snapshot.ts` — is consumed by both the ops
 * overview's Attention panel (via `POST /admin/attention-snapshot`) and, in a
 * follow-up issue, the diagnostic gateway's `get_system_snapshot`. Neither
 * consumer may fork this computation into a second implementation.
 *
 * These types intentionally carry no presentation concerns (no `href`, no
 * display label, no card layout) — callers map `AttentionConditionCode` +
 * `evidenceId` to their own view model.
 */

/** Severity of an abnormal condition. Unlike the ops view model's `OverviewSeverity`,
 *  there is no `good`/`unknown` here — a condition, by definition, describes
 *  something abnormal; backend reachability is reported separately via
 *  `AttentionSignalAvailability`. */
export type AttentionSeverity = 'warning' | 'critical'

export type AttentionConditionCode =
  | 'service_unhealthy'
  | 'source_needs_remap'
  | 'source_error'
  | 'source_inventory_discrepancy'
  | 'queue_failed_jobs'
  | 'queue_paused'
  | 'schedule_disabled'
  | 'schedule_failed'
  | 'scraper_no_successful_run'
  | 'scraper_stale_run'
  | 'geocode_failed'
  | 'geocode_paused'

export interface AttentionCondition {
  code: AttentionConditionCode
  severity: AttentionSeverity
  /**
   * Stable reference to the evidence backing this condition, e.g.
   * `service:<name>`, `source:<id>`, `queue:<name>`, `schedule:<id>`,
   * `run:<id>`. Consumers resolve this to a human label using data they
   * already hold (e.g. a source name looked up by id) rather than the
   * domain baking display copy.
   */
  evidenceId: string
  /** Factual, data-derived explanation — not styled display copy. */
  detail: string
}

/** The four independent signal backends `get_system_snapshot` (follow-up
 *  issue) will also report against. This issue only ever populates `health`,
 *  `bullmq`, and `db` from caller-supplied data; `loki` is reserved so the
 *  future diagnostic gateway can share this exact contract without a fork. */
export type AttentionSignalKey = 'health' | 'bullmq' | 'db' | 'loki'
export type AttentionSignalStatus = 'available' | 'unavailable'
export type AttentionSignalAvailability = Record<AttentionSignalKey, AttentionSignalStatus>

export interface AttentionSnapshot {
  conditions: AttentionCondition[]
  signalAvailability: AttentionSignalAvailability
}

// ── Input contract ──────────────────────────────────────────────────────────
// The computation is a pure function over already-known resource state; it
// never fetches anything itself. A caller reports each resource's data (or
// null) plus whether that resource is known to have failed — distinct from
// "not yet loaded", which callers should represent as `{ data: null,
// unavailable: false }` so no condition/signal-unavailability is inferred
// prematurely.

export interface AttentionResourceInput<T> {
  data: T | null
  /** True once the caller knows this resource's fetch failed or settled
   *  with no data; false while still awaiting a first response. */
  unavailable: boolean
}

export interface AttentionQueueSignal {
  name: string
  paused: boolean
  stats: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  }
}

export interface AttentionSourceSignal {
  id: string
  name: string
  status: string
  errorMessage: string | null
  listingCount: number
  possiblyGoneCount: number
}

export interface AttentionRunSignal {
  id: string
  sourceId: string
  finishedAt: string | null
  success: boolean | null
}

export interface AttentionScheduleSignal {
  id: string
  label: string
  enabled: boolean
  recentFailureCount: number
}

export interface AttentionSnapshotRequest {
  /** ISO timestamp the caller considers "now" (used for staleness/age math),
   *  so a computation replayed later in tests is deterministic. */
  now: string
  health: AttentionResourceInput<HealthResponse>
  queues: AttentionResourceInput<AttentionQueueSignal[]>
  sources: AttentionResourceInput<AttentionSourceSignal[]>
  runs: AttentionResourceInput<AttentionRunSignal[]>
  schedules: AttentionResourceInput<AttentionScheduleSignal[]>
}
