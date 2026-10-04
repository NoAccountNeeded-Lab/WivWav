import type { ActionFailure, JobSnapshot } from './action-client'

export type ActionKind = 'source-run' | 'detail-crawl' | 'detail-extract' | 'search-rebuild'

export type ActionOutcome = 'enqueuing' | 'queued' | 'running' | 'completed' | 'failed' | 'unavailable'

/** State captured when the operator pressed the button — recovery is judged against it. */
export interface ActionBaseline {
  /** Fingerprints of problems tied to the action's source at request time. */
  problemFingerprints: string[]
  /** Pipeline stage state for detail actions; null when it was not known. */
  stage: { failedCount: number; stalled: boolean } | null
  /** Search readings for rebuild actions; null when the summary was not loaded. */
  search: { searchAvailable: boolean; indexed: number | null; eligible: number | null } | null
}

export interface TrackedAction {
  id: string
  kind: ActionKind
  label: string
  sourceId: string | null
  sourceName: string | null
  queue: string | null
  jobId: string | null
  /** Client clock when requested. */
  requestedAtMs: number
  outcome: ActionOutcome
  /** Plain-language detail for the current outcome (failure reason, why unavailable, ...). */
  detail: string | null
  /** Why the enqueue request itself failed; set only when `jobId` is null. */
  failure: Pick<ActionFailure, 'status' | 'code' | 'message'> | null
  /** Last status-check error, kept alongside the last known outcome. */
  checkError: string | null
  /** Server timestamps from the job record. */
  jobCreatedAtMs: number | null
  jobFinishedAtMs: number | null
  /** Client clock when this tab first saw the job terminal; evidence must be fetched after it. */
  terminalObservedAtMs: number | null
  baseline: ActionBaseline
}

export function isPendingOutcome(outcome: ActionOutcome): boolean {
  return outcome === 'enqueuing' || outcome === 'queued' || outcome === 'running'
}

export function outcomeLabel(outcome: ActionOutcome): string {
  switch (outcome) {
    case 'enqueuing': return 'Sending request'
    case 'queued': return 'Queued'
    case 'running': return 'Running'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
    case 'unavailable': return 'Status unavailable'
  }
}

/** Tolerated client/server clock difference when comparing a job's finish time with a request time. */
const CLOCK_SKEW_MS = 60_000

export type JobObservation =
  | { kind: 'job'; job: JobSnapshot | null }
  | { kind: 'error'; message: string }

function parseMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Folds one queue-status observation into a tracked action. A job missing
 * from the queue's list is *unavailable* — never completed — and a terminal
 * job that finished before this request (a fixed-id job such as the search
 * rebuild resolving to an earlier retained run) is not this request's result.
 */
export function applyJobObservation(action: TrackedAction, observation: JobObservation, nowMs: number): TrackedAction {
  if (action.jobId === null) return action
  if (observation.kind === 'error') {
    return { ...action, checkError: `Status check failed: ${observation.message}` }
  }
  const { job } = observation
  if (job === null) {
    if (action.terminalObservedAtMs !== null) return { ...action, checkError: null }
    return {
      ...action,
      outcome: 'unavailable',
      checkError: null,
      detail: `Job ${action.jobId} is not in the ${action.queue ?? 'queue'} retained job list, so its outcome cannot be determined.`,
    }
  }
  const finishedAtMs = parseMs(job.finishedAt)
  const createdAtMs = parseMs(job.createdAt)
  const terminal = job.status === 'completed' || job.status === 'failed'
  if (terminal && finishedAtMs !== null && finishedAtMs < action.requestedAtMs - CLOCK_SKEW_MS) {
    return {
      ...action,
      outcome: 'unavailable',
      checkError: null,
      jobCreatedAtMs: createdAtMs,
      jobFinishedAtMs: finishedAtMs,
      detail: `Job ${action.jobId} finished before this request, so the queue reused an earlier job. Its result is not this request's.`,
    }
  }
  return {
    ...action,
    outcome: job.status,
    checkError: null,
    detail: job.status === 'failed' ? (job.failedReason ?? 'The job failed without a reason.') : null,
    jobCreatedAtMs: createdAtMs,
    jobFinishedAtMs: finishedAtMs,
    terminalObservedAtMs: terminal ? (action.terminalObservedAtMs ?? nowMs) : null,
  }
}
