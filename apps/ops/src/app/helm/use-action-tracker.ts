'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { problemSourceId } from '../ops/problem-presentation'
import type { PipelineStage } from '../ops/sources/[id]/source-pipeline-helpers'
import { fetchJson } from '@/lib/fetch-json'
import {
  enqueueSearchRebuild, enqueueSourceRun, enqueueSourceStage, fetchQueueJob,
  type ActionResult, type EnqueuedJob, type SourceStageQueue,
} from './action-client'
import { assessRecovery, EVIDENCE_DEADLINE_MS, type EvidenceSlot, type PipelineEvidence, type RecoveryEvidence, type RecoveryVerdict } from './recovery'
import { applyJobObservation, isPendingOutcome, type ActionBaseline, type ActionKind, type TrackedAction } from './tracked-action'
import type { HelmData } from './use-helm-data'
import type { SourcePipelineData } from './use-source-evidence'

/** GET /admin/queues/:name loads every retained job and its logs, so job tracking stays modest. */
const TRACK_INTERVAL_MS = 10_000

export interface ActionSource {
  id: string
  name: string
}

export interface ActionTracker {
  actions: TrackedAction[]
  verdictFor: (action: TrackedAction) => RecoveryVerdict
  /** True while a same-kind action for this source (or the global rebuild) is still pending. */
  isBusy: (kind: ActionKind, sourceId: string | null) => boolean
  runSourceNow: (source: ActionSource) => Promise<void>
  runStage: (kind: Exclude<ActionKind, 'source-run' | 'search-rebuild'>, source: ActionSource, stage: PipelineStage | null) => Promise<void>
  rebuildSearch: () => Promise<void>
  dismiss: (id: string) => void
}

const STAGE_QUEUE: Record<'detail-crawl' | 'detail-extract', SourceStageQueue> = {
  'detail-crawl': 'detail-crawl',
  'detail-extract': 'detail-extract',
}

const LABEL: Record<ActionKind, string> = {
  'source-run': 'Run source now',
  'detail-crawl': 'Run detail crawl',
  'detail-extract': 'Run detail extraction',
  'search-rebuild': 'Rebuild search index',
}

function slotOf<T>(resource: { data: T | null; error: string | null; updatedAt: Date | null; requestStartedAt?: Date | null }): EvidenceSlot<T> {
  return {
    data: resource.data,
    error: resource.error,
    updatedAtMs: resource.updatedAt?.getTime() ?? null,
    // Freshness is judged on when the request began, not when it answered.
    requestStartedAtMs: resource.requestStartedAt?.getTime() ?? null,
  }
}

let actionCounter = 0

/**
 * Tracks enqueued recovery actions at the workspace root so they survive
 * inspector changes. Each action polls its queue job every few seconds while
 * the tab is visible (never overlapping), then keeps refreshing the affected
 * evidence until a recovery verdict can be judged or the evidence deadline
 * passes. "Completed" is a job state; recovery is a separate, evidence-based
 * verdict (`assessRecovery`).
 */
export function useActionTracker(apiBaseUrl: string, data: HelmData): ActionTracker {
  const [actions, setActions] = useState<TrackedAction[]>([])
  const [pipelines, setPipelines] = useState<Record<string, EvidenceSlot<PipelineEvidence>>>({})
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const dataRef = useRef(data)
  dataRef.current = data
  const inFlight = useRef(false)

  const patch = useCallback((id: string, update: (action: TrackedAction) => TrackedAction) => {
    setActions(prev => prev.map(action => (action.id === id ? update(action) : action)))
  }, [])

  const evidenceFor = useCallback((action: TrackedAction): RecoveryEvidence => {
    const { resources, problems, summary } = data
    return {
      problems: slotOf(problems),
      runs: slotOf(resources.runs),
      sources: slotOf(resources.sources),
      summary: slotOf(summary),
      pipeline: pipelines[action.id] ?? { data: null, error: null, updatedAtMs: null, requestStartedAtMs: null },
    }
  }, [data, pipelines])

  const verdictFor = useCallback(
    (action: TrackedAction) => assessRecovery(action, evidenceFor(action), data.nowMs),
    [evidenceFor, data.nowMs],
  )

  const refreshPipeline = useCallback(async (action: TrackedAction) => {
    if (action.sourceId === null) return
    const startedAtMs = Date.now()
    const result = await fetchJson<SourcePipelineData>(`${apiBaseUrl}/admin/sources/${encodeURIComponent(action.sourceId)}/pipeline`)
    setPipelines(prev => {
      const before = prev[action.id]
      const slot: EvidenceSlot<PipelineEvidence> = result.data
        ? { data: { sourceId: action.sourceId as string, stages: result.data.stages }, error: null, updatedAtMs: Date.now(), requestStartedAtMs: startedAtMs }
        : { data: before?.data ?? null, error: result.error ?? 'Pipeline unavailable', updatedAtMs: before?.updatedAtMs ?? null, requestStartedAtMs: before?.requestStartedAtMs ?? null }
      return { ...prev, [action.id]: slot }
    })
  }, [apiBaseUrl])

  const refreshEvidence = useCallback((action: TrackedAction) => {
    dataRef.current.refreshAll()
    if (action.kind === 'detail-crawl' || action.kind === 'detail-extract') void refreshPipeline(action)
  }, [refreshPipeline])

  const tick = useCallback(async () => {
    if (inFlight.current || document.visibilityState === 'hidden') return
    inFlight.current = true
    try {
      const pending = actionsRef.current.filter(action => action.jobId !== null && action.queue !== null && isPendingOutcome(action.outcome))
      await Promise.all(pending.map(async action => {
        const result = await fetchQueueJob(apiBaseUrl, action.queue as string, action.jobId as string)
        const nowMs = Date.now()
        const next = applyJobObservation(action, result.ok ? { kind: 'job', job: result.value.job } : { kind: 'error', message: result.message }, nowMs)
        patch(action.id, () => next)
        if (next.terminalObservedAtMs !== null && action.terminalObservedAtMs === null) refreshEvidence(next)
      }))
      const nowMs = Date.now()
      for (const action of actionsRef.current) {
        if (action.outcome !== 'completed' || action.terminalObservedAtMs === null) continue
        if (nowMs - action.terminalObservedAtMs > EVIDENCE_DEADLINE_MS) continue
        if (assessRecovery(action, evidenceFor(action), nowMs).state === 'waiting-evidence') refreshEvidence(action)
      }
    } finally {
      inFlight.current = false
    }
  }, [apiBaseUrl, evidenceFor, patch, refreshEvidence])

  const tickRef = useRef(tick)
  tickRef.current = tick
  const hasWork = actions.some(action => isPendingOutcome(action.outcome) || (action.outcome === 'completed' && action.terminalObservedAtMs !== null && data.nowMs - action.terminalObservedAtMs <= EVIDENCE_DEADLINE_MS))
  useEffect(() => {
    if (!hasWork) return undefined
    const id = window.setInterval(() => void tickRef.current(), TRACK_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void tickRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hasWork])

  const start = useCallback(async (
    kind: ActionKind,
    source: ActionSource | null,
    queue: string | null,
    baseline: ActionBaseline,
    enqueue: () => Promise<ActionResult<EnqueuedJob>>,
  ) => {
    actionCounter += 1
    const id = `action-${Date.now()}-${actionCounter}`
    const base: TrackedAction = {
      id, kind, label: LABEL[kind], sourceId: source?.id ?? null, sourceName: source?.name ?? null, queue, jobId: null,
      requestedAtMs: Date.now(), outcome: 'enqueuing', detail: null, failure: null, checkError: null,
      jobCreatedAtMs: null, jobFinishedAtMs: null, terminalObservedAtMs: null, baseline,
    }
    setActions(prev => [base, ...prev])
    const result = await enqueue()
    if (!result.ok) {
      patch(id, action => ({
        ...action,
        outcome: 'failed',
        detail: result.message,
        failure: { status: result.status, code: result.code, message: result.message },
      }))
      return
    }
    patch(id, action => ({ ...action, queue: result.value.queue, jobId: result.value.jobId, outcome: 'queued' }))
    window.setTimeout(() => void tickRef.current(), 1_500)
  }, [patch])

  const sourceBaseline = useCallback((sourceId: string, stage: ActionBaseline['stage']): ActionBaseline => ({
    problemFingerprints: (dataRef.current.problems.data?.problems ?? [])
      .filter(problem => problemSourceId(problem) === sourceId)
      .map(problem => problem.fingerprint),
    stage,
    search: null,
  }), [])

  const runSourceNow = useCallback((source: ActionSource) =>
    start('source-run', source, 'source-scrape', sourceBaseline(source.id, null), () => enqueueSourceRun(apiBaseUrl, source.id)),
  [apiBaseUrl, sourceBaseline, start])

  const runStage = useCallback((kind: 'detail-crawl' | 'detail-extract', source: ActionSource, stage: PipelineStage | null) =>
    start(
      kind, source, STAGE_QUEUE[kind],
      sourceBaseline(source.id, stage ? { failedCount: stage.failedCount, stalled: stage.stalled } : null),
      () => enqueueSourceStage(apiBaseUrl, STAGE_QUEUE[kind], source.id),
    ),
  [apiBaseUrl, sourceBaseline, start])

  const rebuildSearch = useCallback(() => {
    const counts = dataRef.current.summary.data
    const baseline: ActionBaseline = {
      problemFingerprints: [],
      stage: null,
      search: counts
        ? { searchAvailable: counts.availability.search === 'available', indexed: counts.counts.indexed.value, eligible: counts.counts.eligible.value }
        : null,
    }
    return start('search-rebuild', null, 'listing-sync', baseline, () => enqueueSearchRebuild(apiBaseUrl))
  }, [apiBaseUrl, start])

  const isBusy = useCallback((kind: ActionKind, sourceId: string | null) =>
    actions.some(action => action.kind === kind && action.sourceId === sourceId && isPendingOutcome(action.outcome)),
  [actions])

  const dismiss = useCallback((id: string) => setActions(prev => prev.filter(action => action.id !== id)), [])

  return { actions, verdictFor, isBusy, runSourceNow, runStage, rebuildSearch, dismiss }
}
