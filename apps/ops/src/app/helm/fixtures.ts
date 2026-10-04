import type { HelmSummary, ProblemAggregateResponse, ProblemState } from '@wivwav/types'
import type { PipelineStage } from '../ops/sources/[id]/source-pipeline-helpers'
import type { RunRow, SourceRow } from '../ops/overview-helpers'
import type { TrackedAction } from './tracked-action'
import type { EvidenceSlot, RecoveryEvidence } from './recovery'

export const T0 = Date.parse('2026-10-04T10:00:00Z')

export function problem(over: Partial<ProblemState> = {}): ProblemState {
  return {
    fingerprint: 'domain:source_error:source:s1', source: 'domain', severity: 'critical', detail: 'BLVD is in error',
    evidenceId: 'source:s1', href: null, firstSeen: null, lastSeen: null, occurrenceCount: 1, acknowledgedAt: null, acknowledgedBy: null, ...over,
  }
}

export function aggregate(problems: ProblemState[], availability: Partial<ProblemAggregateResponse['availability']> = {}): ProblemAggregateResponse {
  return { problems, availability: { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available', ...availability } }
}

export function source(over: Partial<SourceRow> = {}): SourceRow {
  return { id: 's1', name: 'BLVD', status: 'active', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 120, errorMessage: null, possiblyGoneCount: 0, ...over }
}

export function run(over: Partial<RunRow> = {}): RunRow {
  return {
    id: 'r2', sourceId: 's1', sourceName: 'BLVD', startedAt: new Date(T0 + 5_000).toISOString(), finishedAt: new Date(T0 + 40_000).toISOString(),
    success: true, listingsFound: 80, listingsNew: 1, listingsUpdated: 2, errorMessage: null, ...over,
  }
}

export function stage(over: Partial<PipelineStage> = {}): PipelineStage {
  return { stage: 'detail-crawl', queue: 'detail-crawl', pendingCount: 0, lastCompletedAt: new Date(T0 + 30_000).toISOString(), failedCount: 0, failedScopedToSource: true, stalled: false, latestFailedJobId: null, ...over }
}

export function slot<T>(data: T | null, updatedAtMs: number | null = T0 + 60_000, error: string | null = null): EvidenceSlot<T> {
  return { data, error, updatedAtMs }
}

export function summary(over: Partial<HelmSummary['availability']> & { indexed?: number | null; eligible?: number | null } = {}): HelmSummary {
  const reading = (value: number | null) => ({ value, availability: value === null ? 'unavailable' as const : 'available' as const, collectedAt: value === null ? null : new Date(T0 + 60_000).toISOString() })
  return {
    collectedAt: new Date(T0 + 60_000).toISOString(),
    counts: { stored: reading(100), active: reading(90), eligible: reading(over.eligible === undefined ? 80 : over.eligible), indexed: reading(over.indexed === undefined ? 70 : over.indexed) },
    availability: { database: over.database ?? 'available', search: over.search ?? 'available' },
  }
}

export function evidence(over: Partial<RecoveryEvidence> = {}): RecoveryEvidence {
  return {
    problems: slot(aggregate([])), runs: slot([run()]), sources: slot([source()]),
    pipeline: slot({ sourceId: 's1', stages: [stage()] }), summary: slot(summary()), ...over,
  }
}

export function action(over: Partial<TrackedAction> = {}): TrackedAction {
  return {
    id: 'a1', kind: 'source-run', label: 'Run source now', sourceId: 's1', sourceName: 'BLVD', queue: 'source-scrape', jobId: '7',
    requestedAtMs: T0, outcome: 'completed', detail: null, failure: null, checkError: null,
    jobCreatedAtMs: T0 + 1_000, jobFinishedAtMs: T0 + 40_000, terminalObservedAtMs: T0 + 45_000,
    baseline: { problemFingerprints: ['domain:source_error:source:s1'], stage: null, search: null }, ...over,
  }
}
