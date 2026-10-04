import { describe, expect, it } from 'vitest'
import { assessRecovery, EVIDENCE_DEADLINE_MS } from './recovery'
import { action, aggregate, evidence, problem, run, slot, source, stage, summary, T0 } from './fixtures'

const NOW = T0 + 60_000

describe('assessRecovery: source run', () => {
  it('waits while the job is queued or running', () => {
    expect(assessRecovery(action({ outcome: 'running', terminalObservedAtMs: null }), evidence(), NOW).state).toBe('pending-job')
  })

  it('reports a failed job as not recovered', () => {
    const verdict = assessRecovery(action({ outcome: 'failed', detail: 'timeout' }), evidence(), NOW)
    expect(verdict.state).toBe('not-recovered')
    expect(verdict.reasons).toContain('timeout')
  })

  it('completed with the problem still reported is NOT recovered', () => {
    const verdict = assessRecovery(action(), evidence({ problems: slot(aggregate([problem()])) }), NOW)
    expect(verdict.state).toBe('not-recovered')
    expect(verdict.headline).toMatch(/still reported/)
  })

  it('completed with a failed fresh run is not recovered', () => {
    const verdict = assessRecovery(action(), evidence({ runs: slot([run({ success: false, errorMessage: 'selector missing' })]) }), NOW)
    expect(verdict.state).toBe('not-recovered')
    expect(verdict.reasons.join(' ')).toMatch(/selector missing/)
  })

  it('a successful fresh run, a clean source and a cleared problem confirm recovery', () => {
    const verdict = assessRecovery(action(), evidence(), NOW)
    expect(verdict.state).toBe('recovered')
    expect(verdict.reasons.join(' ')).toMatch(/not matched to the job by id/)
  })

  it('a problem disappearing while domain signals are unavailable is NOT recovery', () => {
    const verdict = assessRecovery(action(), evidence({ problems: slot(aggregate([], { db: 'unavailable' })) }), NOW)
    expect(verdict.state).toBe('unavailable')
    expect(verdict.reasons.join(' ')).toMatch(/not proof/)
  })

  it('unrelated provider outages (grafana) do not block a source-run recovery', () => {
    expect(assessRecovery(action(), evidence({ problems: slot(aggregate([], { grafana: 'unavailable' })) }), NOW).state).toBe('recovered')
  })

  it('a successful run with no baseline source problem makes no recovery claim', () => {
    const quiet = action({ baseline: { problemFingerprints: [], stage: null, search: null } })
    expect(assessRecovery(quiet, evidence(), NOW).state).toBe('no-claim')
  })

  it('a run that started before the job was created is not attributed to it (no skew tolerance)', () => {
    const early = run({ startedAt: new Date(T0 + 1_000 - 1).toISOString() })
    expect(assessRecovery(action(), evidence({ runs: slot([early]) }), NOW).state).toBe('unavailable')
  })

  it('an unknown job creation time cannot attribute a run', () => {
    expect(assessRecovery(action({ jobCreatedAtMs: null }), evidence(), NOW).state).toBe('unavailable')
  })

  it('a run still in progress waits, then becomes unavailable after the evidence deadline', () => {
    const running = evidence({ runs: slot([run({ finishedAt: null, success: null })], T0 + 10_000_000) })
    expect(assessRecovery(action(), running, NOW).state).toBe('waiting-evidence')
    expect(assessRecovery(action(), running, T0 + 45_000 + EVIDENCE_DEADLINE_MS + 1).state).toBe('unavailable')
  })

  it('judges freshness on request start when supplied: a response that landed after the job but began before is not fresh', () => {
    const raced = evidence({ runs: { data: [run()], error: null, updatedAtMs: T0 + 60_000, requestStartedAtMs: T0 + 30_000 } })
    expect(assessRecovery(action(), raced, NOW).state).toBe('waiting-evidence')
    const fresh = evidence({ runs: { data: [run()], error: null, updatedAtMs: T0 + 60_000, requestStartedAtMs: T0 + 50_000 } })
    expect(assessRecovery(action(), fresh, NOW).state).toBe('recovered')
    const unknownStart = evidence({ runs: { data: [run()], error: null, updatedAtMs: T0 + 60_000, requestStartedAtMs: null } })
    expect(assessRecovery(action(), unknownStart, NOW).state).toBe('waiting-evidence')
  })

  it('treats evidence fetched before the job finished as not yet fresh', () => {
    const stale = evidence({ runs: slot([run()], T0 + 10_000) })
    expect(assessRecovery(action(), stale, NOW).state).toBe('waiting-evidence')
  })

  it('gives up waiting after the deadline and says unavailable', () => {
    const stale = evidence({ runs: slot([run()], T0 + 10_000) })
    expect(assessRecovery(action(), stale, T0 + 45_000 + EVIDENCE_DEADLINE_MS + 1).state).toBe('unavailable')
  })

  it('a currently failing resource makes recovery unavailable, even if it has older data', () => {
    expect(assessRecovery(action(), evidence({ problems: slot(aggregate([]), NOW, 'API returned 503') }), NOW).state).toBe('unavailable')
  })

  it('a run that predates the job does not count', () => {
    const old = run({ startedAt: new Date(T0 - 3_600_000).toISOString() })
    expect(assessRecovery(action(), evidence({ runs: slot([old]) }), NOW).state).toBe('unavailable')
  })

  it('a source still flagged in error is not recovered even after a successful run', () => {
    const verdict = assessRecovery(action(), evidence({ sources: slot([source({ status: 'error', errorMessage: 'boom' })]) }), NOW)
    expect(verdict.state).toBe('not-recovered')
  })

  it('does not claim recovery when the job outcome itself is unavailable', () => {
    expect(assessRecovery(action({ outcome: 'unavailable', detail: 'gone' }), evidence(), NOW).state).toBe('unavailable')
  })
})

describe('assessRecovery: source stages', () => {
  const crawl = (over = {}) => action({ kind: 'detail-crawl', queue: 'detail-crawl', baseline: { problemFingerprints: [], stage: { failedCount: 2, stalled: false }, search: null }, ...over })

  it('confirms recovery when the stage had failures, now has none and completed since the job', () => {
    expect(assessRecovery(crawl(), evidence(), NOW).state).toBe('recovered')
  })

  it('still-failing stage is not recovered', () => {
    const e = evidence({ pipeline: slot({ sourceId: 's1', stages: [stage({ failedCount: 1 })] }) })
    expect(assessRecovery(crawl(), e, NOW).state).toBe('not-recovered')
  })

  it('makes no recovery claim when the stage was healthy before', () => {
    const healthy = crawl({ baseline: { problemFingerprints: [], stage: { failedCount: 0, stalled: false }, search: null } })
    expect(assessRecovery(healthy, evidence(), NOW).state).toBe('no-claim')
  })

  it('ignores pipeline evidence for a different source', () => {
    const e = evidence({ pipeline: slot({ sourceId: 'other', stages: [stage()] }) })
    expect(assessRecovery(crawl(), e, NOW).state).toBe('waiting-evidence')
  })

  it('a stage completion before the job was created does not confirm recovery (no skew tolerance)', () => {
    const e = evidence({ pipeline: slot({ sourceId: 's1', stages: [stage({ lastCompletedAt: new Date(T0 + 1_000 - 1).toISOString() })] }) })
    expect(assessRecovery(crawl(), e, NOW).state).toBe('unavailable')
    expect(assessRecovery(crawl({ jobCreatedAtMs: null }), evidence(), NOW).state).toBe('unavailable')
  })

  it('cannot attribute failures that are not scoped to the source', () => {
    const e = evidence({ pipeline: slot({ sourceId: 's1', stages: [stage({ failedScopedToSource: false })] }) })
    expect(assessRecovery(crawl(), e, NOW).state).toBe('unavailable')
  })
})

describe('assessRecovery: search rebuild', () => {
  const rebuild = (search: { searchAvailable: boolean; indexed: number | null; eligible: number | null } | null) =>
    action({ kind: 'search-rebuild', sourceId: null, sourceName: null, queue: 'listing-sync', jobId: 'listing-sync-rebuild', baseline: { problemFingerprints: [], stage: null, search } })

  it('confirms recovery only when search was down/empty and is now reachable with documents', () => {
    expect(assessRecovery(rebuild({ searchAvailable: false, indexed: null, eligible: 80 }), evidence(), NOW).state).toBe('recovered')
    expect(assessRecovery(rebuild({ searchAvailable: true, indexed: 0, eligible: 80 }), evidence(), NOW).state).toBe('recovered')
  })

  it('the recovery claim is precise and discloses it is not proof of a complete rebuild', () => {
    const verdict = assessRecovery(rebuild({ searchAvailable: false, indexed: null, eligible: 80 }), evidence(), NOW)
    expect(verdict.headline).toMatch(/reachable and non-empty/)
    expect(verdict.reasons.join(' ')).toMatch(/not proof the index was fully rebuilt/)
  })

  it('a search reading collected before the rebuild finished does not confirm recovery', () => {
    const before = summary()
    before.counts.indexed.collectedAt = new Date(T0 + 39_000).toISOString()
    const e = evidence({ summary: slot(before) })
    expect(assessRecovery(rebuild({ searchAvailable: false, indexed: null, eligible: 80 }), e, NOW).state).toBe('unavailable')
  })

  it('does not claim recovery when search was not recorded as broken (counts legitimately diverge)', () => {
    expect(assessRecovery(rebuild({ searchAvailable: true, indexed: 40, eligible: 80 }), evidence(), NOW).state).toBe('no-claim')
    expect(assessRecovery(rebuild(null), evidence(), NOW).state).toBe('no-claim')
  })

  it('still-unavailable search after a rebuild is unconfirmed, never recovered', () => {
    const e = evidence({ summary: slot(summary({ search: 'unavailable', indexed: null })) })
    expect(assessRecovery(rebuild({ searchAvailable: false, indexed: null, eligible: 80 }), e, NOW).state).toBe('unavailable')
  })

  it('an index that is still empty with eligible listings is not recovered', () => {
    const e = evidence({ summary: slot(summary({ indexed: 0, eligible: 80 })) })
    expect(assessRecovery(rebuild({ searchAvailable: true, indexed: 0, eligible: 80 }), e, NOW).state).toBe('not-recovered')
  })
})
