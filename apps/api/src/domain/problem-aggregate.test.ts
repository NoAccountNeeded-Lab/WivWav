import { describe, expect, it } from 'vitest'
import type {
  AttentionSnapshotRequest,
  GrafanaAlertsResourceInput,
  ProblemAggregateRequest,
  SentryIssuesResourceInput,
} from '@wivwav/types'
import { computeAttentionSnapshot } from './attention-snapshot.js'
import { computeProblemAggregate } from './problem-aggregate.js'

const NOW = '2026-06-18T18:00:00.000Z'

function baseDomainRequest(overrides: Partial<AttentionSnapshotRequest> = {}): AttentionSnapshotRequest {
  return {
    now: NOW,
    health: { data: null, unavailable: false },
    queues: { data: null, unavailable: false },
    sources: { data: null, unavailable: false },
    runs: { data: null, unavailable: false },
    schedules: { data: null, unavailable: false },
    ...overrides,
  }
}

const availableGrafana: GrafanaAlertsResourceInput = {
  unavailable: false,
  data: [
    { ruleUid: 'wivwav-api-down', alertname: 'API target down', state: 'alerting', severity: 'critical', summary: 'API is unreachable', activeAt: '2026-06-18T17:30:00.000Z' },
    { ruleUid: 'wivwav-queue-depth', alertname: 'Queue depth high', state: 'pending', severity: 'warning', summary: null, activeAt: '2026-06-18T17:45:00.000Z' },
    { ruleUid: 'wivwav-db-down', alertname: 'DB down', state: 'normal', severity: 'critical', summary: 'stale, resolved', activeAt: null },
  ],
}

const availableSentry: SentryIssuesResourceInput = {
  unavailable: false,
  data: [
    { id: 'sentry-1', title: 'TypeError: x is not a function', culprit: 'apps/api/src/routes/listings.ts', level: 'error', count: 42, firstSeen: '2026-06-10T00:00:00.000Z', lastSeen: '2026-06-18T17:00:00.000Z', permalink: 'https://sentry.io/issues/sentry-1' },
  ],
}

function baseRequest(overrides: Partial<ProblemAggregateRequest> = {}): ProblemAggregateRequest {
  return {
    domain: baseDomainRequest(),
    grafana: availableGrafana,
    sentry: availableSentry,
    ...overrides,
  }
}

describe('computeProblemAggregate', () => {
  it('federates problems from all three sources when all are available', () => {
    const aggregate = computeProblemAggregate(baseRequest({
      domain: baseDomainRequest({
        queues: {
          data: [{ name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 1, delayed: 0 } }],
          unavailable: false,
        },
      }),
    }))

    expect(aggregate.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'domain', fingerprint: 'domain:queue_failed_jobs:queue:*', href: null }),
      expect.objectContaining({ source: 'grafana', fingerprint: 'grafana:wivwav-api-down', severity: 'critical', href: null }),
      expect.objectContaining({ source: 'grafana', fingerprint: 'grafana:wivwav-queue-depth', severity: 'warning', href: null }),
      expect.objectContaining({ source: 'sentry', fingerprint: 'sentry:sentry-1', occurrenceCount: 42, href: 'https://sentry.io/issues/sentry-1' }),
    ]))
    // A resolved ('normal') Grafana alert instance contributes no problem.
    expect(aggregate.problems.some(p => p.fingerprint === 'grafana:wivwav-db-down')).toBe(false)
    expect(aggregate.availability).toEqual({ health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' })
  })

  it('returns domain-sourced problems and marks Grafana unavailable when it is unreachable', () => {
    const aggregate = computeProblemAggregate(baseRequest({
      domain: baseDomainRequest({
        queues: {
          data: [{ name: 'geocode', paused: false, stats: { waiting: 0, active: 0, completed: 0, failed: 1, delayed: 0 } }],
          unavailable: false,
        },
      }),
      grafana: { data: null, unavailable: true },
    }))

    expect(aggregate.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'domain', fingerprint: 'domain:queue_failed_jobs:queue:*' }),
      expect.objectContaining({ source: 'sentry', fingerprint: 'sentry:sentry-1' }),
    ]))
    expect(aggregate.problems.some(p => p.source === 'grafana')).toBe(false)
    expect(aggregate.availability.grafana).toBe('unavailable')
    expect(aggregate.availability.sentry).toBe('available')
  })

  it('returns domain-sourced problems and marks Sentry unavailable when it is unreachable', () => {
    const aggregate = computeProblemAggregate(baseRequest({
      sentry: { data: null, unavailable: true },
    }))

    expect(aggregate.problems.some(p => p.source === 'grafana')).toBe(true)
    expect(aggregate.problems.some(p => p.source === 'sentry')).toBe(false)
    expect(aggregate.availability.sentry).toBe('unavailable')
    expect(aggregate.availability.grafana).toBe('available')
  })

  it('returns an empty problem list when there is nothing wrong anywhere', () => {
    const aggregate = computeProblemAggregate(baseRequest({
      domain: baseDomainRequest(),
      grafana: { data: [], unavailable: false },
      sentry: { data: [], unavailable: false },
    }))

    expect(aggregate.problems).toEqual([])
    expect(aggregate.availability).toEqual({ health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' })
  })

  it('produces a stable fingerprint across two calls with unchanged input', () => {
    const request = baseRequest()
    const first = computeProblemAggregate(request)
    const second = computeProblemAggregate(request)

    expect(first.problems.map(p => p.fingerprint).sort()).toEqual(second.problems.map(p => p.fingerprint).sort())
    expect(first).toEqual(second)
  })

  it('produces the same fingerprint and detail as computeAttentionSnapshot for the same domain condition', () => {
    const domainRequest = baseDomainRequest({
      queues: {
        data: [{ name: 'geocode', paused: true, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } }],
        unavailable: false,
      },
    })

    const snapshot = computeAttentionSnapshot(domainRequest)
    const aggregate = computeProblemAggregate(baseRequest({ domain: domainRequest }))

    expect(snapshot.conditions.length).toBeGreaterThan(0)
    for (const condition of snapshot.conditions) {
      const problem = aggregate.problems.find(p => p.source === 'domain' && p.evidenceId === condition.evidenceId && p.detail === condition.detail)
      expect(problem).toBeDefined()
      expect(problem?.fingerprint).toBe(`domain:${condition.code}:${condition.evidenceId}`)
      expect(problem?.severity).toBe(condition.severity)
    }
  })
})
