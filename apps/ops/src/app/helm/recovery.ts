import type { ProblemAggregateResponse } from '@wivwav/types'
import type { HelmSummary } from '@wivwav/types'
import { problemSourceId } from '../ops/problem-presentation'
import type { RunRow, SourceRow } from '../ops/overview-helpers'
import type { PipelineStage } from '../ops/sources/[id]/source-pipeline-helpers'
import { isPendingOutcome, type TrackedAction } from './tracked-action'

/**
 * Recovery judgement for /helm actions (issue #1071). A completed job only
 * means the work ran; it never means the problem is fixed. "Recovered" needs
 * *fresh, relevant* evidence fetched after the job finished that actually
 * shows improvement. Missing, failed or stale evidence is reported as
 * unavailable, and a problem simply disappearing never counts when the
 * signals that could hide it were themselves unavailable.
 */

export interface EvidenceSlot<T> {
  data: T | null
  /** Current error for this resource; a slot with an error is never fresh. */
  error: string | null
  /** Client clock of the last successful fetch. */
  updatedAtMs: number | null
}

export interface PipelineEvidence {
  sourceId: string
  stages: PipelineStage[]
}

export interface RecoveryEvidence {
  problems: EvidenceSlot<ProblemAggregateResponse>
  runs: EvidenceSlot<RunRow[]>
  sources: EvidenceSlot<SourceRow[]>
  pipeline: EvidenceSlot<PipelineEvidence>
  summary: EvidenceSlot<HelmSummary>
}

export type RecoveryState =
  | 'pending-job'
  | 'waiting-evidence'
  | 'recovered'
  | 'not-recovered'
  | 'unavailable'
  | 'no-claim'

export interface RecoveryVerdict {
  state: RecoveryState
  headline: string
  /** Each line is a fact the verdict rests on, or what is missing. */
  reasons: string[]
}

/** How long after completion we keep waiting for fresh evidence before calling it unavailable. */
export const EVIDENCE_DEADLINE_MS = 3 * 60_000

/** Tolerated difference between the job's and the run's server timestamps. */
const SERVER_SKEW_MS = 30_000

/** Signals that can make a domain (source/queue/service) problem vanish without it being fixed. */
const DOMAIN_SIGNALS = ['health', 'bullmq', 'db'] as const

type SlotState = 'fresh' | 'pending' | 'failed'

function slotState<T>(slot: EvidenceSlot<T>, sinceMs: number): SlotState {
  if (slot.error !== null) return 'failed'
  if (slot.data === null || slot.updatedAtMs === null) return 'pending'
  return slot.updatedAtMs > sinceMs ? 'fresh' : 'pending'
}

function parseMs(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function verdict(state: RecoveryState, headline: string, reasons: string[] = []): RecoveryVerdict {
  return { state, headline, reasons }
}

/** Resolves slot readiness for a set of named slots into one early verdict, or null when all are fresh. */
function gateEvidence(
  action: TrackedAction,
  nowMs: number,
  slots: { name: string; state: SlotState }[],
): RecoveryVerdict | null {
  const failed = slots.filter(slot => slot.state === 'failed')
  if (failed.length > 0) {
    return verdict('unavailable', 'Recovery cannot be confirmed: evidence is unavailable.', failed.map(slot => `${slot.name} could not be refreshed.`))
  }
  const pending = slots.filter(slot => slot.state === 'pending')
  if (pending.length > 0) {
    const observed = action.terminalObservedAtMs ?? nowMs
    if (nowMs - observed > EVIDENCE_DEADLINE_MS) {
      return verdict('unavailable', 'Recovery cannot be confirmed: fresh evidence did not arrive in time.', pending.map(slot => `${slot.name} has not refreshed since the job finished.`))
    }
    return verdict('waiting-evidence', 'Job finished. Waiting for fresh evidence to judge recovery.', pending.map(slot => `Waiting for ${slot.name}.`))
  }
  return null
}

function jobGate(action: TrackedAction): RecoveryVerdict | null {
  if (isPendingOutcome(action.outcome)) return verdict('pending-job', 'Waiting for the job to finish.')
  if (action.outcome === 'failed') return verdict('not-recovered', 'Not recovered: the job failed.', [action.detail ?? 'The job failed without a reason.'])
  if (action.outcome === 'unavailable') return verdict('unavailable', 'Recovery cannot be confirmed: the job outcome is unavailable.', action.detail ? [action.detail] : [])
  return null
}

function assessSourceRun(action: TrackedAction, evidence: RecoveryEvidence, nowMs: number): RecoveryVerdict {
  const sourceId = action.sourceId
  const since = action.terminalObservedAtMs ?? nowMs
  if (sourceId === null) return verdict('unavailable', 'Recovery cannot be confirmed: no source is attached to this action.')
  const gate = gateEvidence(action, nowMs, [
    { name: 'Scrape runs', state: slotState(evidence.runs, since) },
    { name: 'Source status', state: slotState(evidence.sources, since) },
    { name: 'Problem aggregate', state: slotState(evidence.problems, since) },
  ])
  if (gate) return gate

  const createdAt = action.jobCreatedAtMs
  const run = (evidence.runs.data ?? [])
    .filter(row => row.sourceId === sourceId && (createdAt === null || (parseMs(row.startedAt) ?? 0) >= createdAt - SERVER_SKEW_MS))
    .sort((a, b) => (parseMs(b.startedAt) ?? 0) - (parseMs(a.startedAt) ?? 0))[0]
  if (!run) {
    return verdict('unavailable', 'Recovery cannot be confirmed: no scrape run was recorded for this source after the job was created.')
  }
  const runDescription = `Latest run for this source since the job was created (not matched to the job by id): started ${run.startedAt}`
  if (run.finishedAt === null) return verdict('waiting-evidence', 'The scrape run is still in progress.', [runDescription])
  if (run.success !== true) {
    return verdict('not-recovered', 'Not recovered: the latest run did not succeed.', [runDescription, run.errorMessage ?? 'The run reported no success.'])
  }
  const source = (evidence.sources.data ?? []).find(row => row.id === sourceId)
  if (!source) return verdict('unavailable', 'Recovery cannot be confirmed: the source is missing from the refreshed source list.', [runDescription])
  if (source.status === 'error' || source.status === 'needs_remapping' || source.errorMessage) {
    return verdict('not-recovered', 'Not recovered: the run succeeded but the source is still flagged.', [
      runDescription,
      `Source status is ${source.status.replaceAll('_', ' ')}${source.errorMessage ? `: ${source.errorMessage}` : ''}.`,
    ])
  }

  const aggregate = evidence.problems.data
  const missingSignals = aggregate ? DOMAIN_SIGNALS.filter(signal => aggregate.availability[signal] === 'unavailable') : [...DOMAIN_SIGNALS]
  const stillReported = (aggregate?.problems ?? []).filter(problem =>
    problemSourceId(problem) === sourceId || action.baseline.problemFingerprints.includes(problem.fingerprint))
  if (stillReported.length > 0) {
    return verdict('not-recovered', 'Not recovered: the job completed but the problem is still reported.', [
      runDescription,
      ...stillReported.map(problem => `Still reported: ${problem.detail}`),
    ])
  }
  if (missingSignals.length > 0) {
    return verdict('unavailable', 'Recovery cannot be confirmed: problem signals that could hide the problem are unavailable.', [
      runDescription,
      `Unavailable: ${missingSignals.join(', ')}. The problem not appearing is not proof it is fixed.`,
    ])
  }
  return verdict('recovered', 'Recovered: fresh evidence confirms the source is working again.', [
    runDescription,
    `finished successfully at ${run.finishedAt}.`,
    'Source status is no longer in error and no source problem is reported with all domain signals available.',
  ])
}

function assessSourceStage(action: TrackedAction, evidence: RecoveryEvidence, nowMs: number): RecoveryVerdict {
  const sourceId = action.sourceId
  const since = action.terminalObservedAtMs ?? nowMs
  if (sourceId === null || action.queue === null) return verdict('unavailable', 'Recovery cannot be confirmed: no source is attached to this action.')
  const pipeline = evidence.pipeline.data?.sourceId === sourceId ? evidence.pipeline : { ...evidence.pipeline, data: null }
  const gate = gateEvidence(action, nowMs, [{ name: 'Source pipeline', state: slotState(pipeline, since) }])
  if (gate) return gate

  const stage = pipeline.data?.stages.find(candidate => candidate.queue === action.queue)
  if (!stage) return verdict('unavailable', `Recovery cannot be confirmed: the pipeline reports no ${action.queue} stage for this source.`)
  if (!stage.failedScopedToSource) {
    return verdict('unavailable', 'Recovery cannot be confirmed: this stage’s failures are not scoped to the source.')
  }
  const reasons = [`Stage ${action.queue}: ${stage.failedCount} failed job(s) for this source, ${stage.pendingCount} pending, ${stage.stalled ? 'stalled' : 'not stalled'}.`]
  if (stage.failedCount > 0) return verdict('not-recovered', 'Not recovered: the job completed but this source’s stage still has failures.', reasons)
  if (stage.stalled) return verdict('not-recovered', 'Not recovered: the job completed but the stage is still stalled.', reasons)
  const base = action.baseline.stage
  if (base && base.failedCount === 0 && !base.stalled) {
    return verdict('no-claim', 'Completed. The stage had no failure before this action, so no recovery is claimed.', reasons)
  }
  const completedAt = parseMs(stage.lastCompletedAt)
  const jobCreated = action.jobCreatedAtMs
  if (completedAt === null || (jobCreated !== null && completedAt < jobCreated - SERVER_SKEW_MS)) {
    return verdict('unavailable', 'Recovery cannot be confirmed: the stage shows no completion since this job was created.', reasons)
  }
  return verdict('recovered', 'Recovered: fresh pipeline evidence shows the stage completing with no failures.', [...reasons, `Last completion ${stage.lastCompletedAt}.`])
}

function assessSearchRebuild(action: TrackedAction, evidence: RecoveryEvidence, nowMs: number): RecoveryVerdict {
  const since = action.terminalObservedAtMs ?? nowMs
  const gate = gateEvidence(action, nowMs, [{ name: 'Inventory summary', state: slotState(evidence.summary, since) }])
  if (gate) return gate

  const summary = evidence.summary.data
  if (!summary) return verdict('unavailable', 'Recovery cannot be confirmed: no inventory summary is loaded.')
  const base = action.baseline.search
  const hadSearchProblem = base !== null && (!base.searchAvailable || (base.indexed === 0 && (base.eligible ?? 0) > 0))
  const indexed = summary.counts.indexed
  const reasons = [
    summary.availability.search === 'available' && indexed.value !== null
      ? `Search index now reports ${indexed.value.toLocaleString()} documents (an independent reading, collected ${indexed.collectedAt ?? 'at an unknown time'}).`
      : 'The search index reading is unavailable.',
  ]
  if (base === null) {
    return verdict('no-claim', 'Rebuild completed. No search reading was recorded before it, so no recovery is claimed.', reasons)
  }
  if (!hadSearchProblem) {
    return verdict('no-claim', 'Rebuild completed. Search was not recorded as down or empty before it, so no recovery is claimed.', reasons)
  }
  if (summary.availability.search === 'unavailable' || indexed.value === null) {
    return verdict('unavailable', 'Recovery cannot be confirmed: the search index reading is still unavailable.', reasons)
  }
  const eligible = summary.counts.eligible.value
  if (indexed.value > 0 || eligible === 0) {
    return verdict('recovered', 'Recovered: the search index is reachable and holds documents again.', reasons)
  }
  return verdict('not-recovered', 'Not recovered: the rebuild completed but the search index is still empty while eligible listings exist.', reasons)
}

export function assessRecovery(action: TrackedAction, evidence: RecoveryEvidence, nowMs: number): RecoveryVerdict {
  const early = jobGate(action)
  if (early) return early
  switch (action.kind) {
    case 'source-run': return assessSourceRun(action, evidence, nowMs)
    case 'detail-crawl':
    case 'detail-extract': return assessSourceStage(action, evidence, nowMs)
    case 'search-rebuild': return assessSearchRebuild(action, evidence, nowMs)
  }
}

export function recoveryStateLabel(state: RecoveryState): string {
  switch (state) {
    case 'pending-job': return 'Waiting for job'
    case 'waiting-evidence': return 'Waiting for fresh evidence'
    case 'recovered': return 'Recovery confirmed'
    case 'not-recovered': return 'Not recovered'
    case 'unavailable': return 'Recovery unconfirmed'
    case 'no-claim': return 'Completed, no recovery claimed'
  }
}
