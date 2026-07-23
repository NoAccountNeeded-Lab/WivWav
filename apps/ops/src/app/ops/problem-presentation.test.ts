import { describe, expect, it } from 'vitest'
import type { ProblemState } from '@wivwav/types'
import {
  isAcknowledged,
  presentProblem,
  problemCountsBySeverity,
  sortProblems,
  unacknowledgedProblems,
} from './problem-presentation.js'

function problem(overrides: Partial<ProblemState> = {}): ProblemState {
  return {
    fingerprint: 'domain:queue_failed_jobs:queue:*',
    source: 'domain',
    severity: 'critical',
    detail: '3 failed jobs are present across queues.',
    evidenceId: 'queue:*',
    href: null,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-18T00:00:00.000Z',
    occurrenceCount: 3,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...overrides,
  }
}

describe('presentProblem', () => {
  it('resolves a source-scoped domain condition to the source name and /ops/sources', () => {
    const result = presentProblem(
      problem({ fingerprint: 'domain:source_needs_remap:source:src-1', evidenceId: 'source:src-1' }),
      { health: null, sources: [{ id: 'src-1', name: 'BLVD.com', status: 'needs_remapping', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 0, errorMessage: null, possiblyGoneCount: 0 }] },
    )

    expect(result).toEqual({ title: 'BLVD.com needs remapping', detail: expect.any(String), href: '/ops/sources', external: false })
  })

  it('resolves a service_unhealthy condition using the raw service health, not a generic message', () => {
    const result = presentProblem(
      problem({ fingerprint: 'domain:service_unhealthy:service:postgres', evidenceId: 'service:postgres', detail: 'fallback detail' }),
      { health: { status: 'degraded', timestamp: '2026-06-18T00:00:00.000Z', services: { postgres: { status: 'down' } } } as never, sources: null },
    )

    expect(result.title).toBe('Database is down')
    expect(result.href).toBe('/status')
  })

  it('routes a valkey service_unhealthy condition to /ops/queues instead of /status', () => {
    const result = presentProblem(
      problem({ fingerprint: 'domain:service_unhealthy:service:valkey', evidenceId: 'service:valkey' }),
      { health: null, sources: null },
    )

    expect(result.href).toBe('/ops/queues')
  })

  it('maps known non-source domain codes to their fix surface', () => {
    const result = presentProblem(problem(), { health: null, sources: null })
    expect(result).toEqual({ title: 'Failed jobs need review', detail: problem().detail, href: '/ops/queues', external: false })
  })

  it('falls back to the raw detail for an unrecognised domain code rather than throwing', () => {
    const result = presentProblem(
      problem({ fingerprint: 'domain:some_future_code:evidence:1', evidenceId: 'evidence:1', detail: 'Something new' }),
      { health: null, sources: null },
    )
    expect(result).toEqual({ title: 'Something new', detail: 'Something new', href: '/status', external: false })
  })

  it('links a Sentry problem to its permalink and marks it external', () => {
    const result = presentProblem(
      problem({ source: 'sentry', fingerprint: 'sentry:sentry-1', evidenceId: 'sentry:sentry-1', href: 'https://sentry.io/issues/sentry-1', detail: 'TypeError: x is not a function' }),
      { health: null, sources: null },
    )
    expect(result).toEqual({ title: 'TypeError: x is not a function', detail: 'Reported by Sentry', href: 'https://sentry.io/issues/sentry-1', external: true })
  })

  it('falls back to /status for a Grafana problem, which never carries an href', () => {
    const result = presentProblem(
      problem({ source: 'grafana', fingerprint: 'grafana:wivwav-api-down', evidenceId: 'grafana:wivwav-api-down', detail: 'API is unreachable' }),
      { health: null, sources: null },
    )
    expect(result).toEqual({ title: 'API is unreachable', detail: 'Grafana infrastructure alert', href: '/status', external: false })
  })
})

describe('isAcknowledged / unacknowledgedProblems', () => {
  it('treats a problem with acknowledgedAt set as acknowledged', () => {
    const ack = problem({ acknowledgedAt: '2026-06-19T00:00:00.000Z', acknowledgedBy: 'ops@example.com' })
    const unack = problem({ fingerprint: 'domain:queue_paused:queue:*' })

    expect(isAcknowledged(ack)).toBe(true)
    expect(isAcknowledged(unack)).toBe(false)
    expect(unacknowledgedProblems([ack, unack])).toEqual([unack])
  })
})

describe('problemCountsBySeverity', () => {
  it('counts critical and warning problems independently', () => {
    const problems = [
      problem({ severity: 'critical' }),
      problem({ fingerprint: 'domain:queue_paused:queue:*', severity: 'warning' }),
      problem({ fingerprint: 'domain:schedule_disabled:schedule:*', severity: 'warning' }),
    ]
    expect(problemCountsBySeverity(problems)).toEqual({ critical: 1, warning: 2 })
  })
})

describe('sortProblems', () => {
  it('orders critical before warning, then most recently seen first within a severity', () => {
    const oldCritical = problem({ fingerprint: 'a', severity: 'critical', lastSeen: '2026-06-01T00:00:00.000Z' })
    const newCritical = problem({ fingerprint: 'b', severity: 'critical', lastSeen: '2026-06-18T00:00:00.000Z' })
    const warning = problem({ fingerprint: 'c', severity: 'warning', lastSeen: '2026-06-19T00:00:00.000Z' })

    expect(sortProblems([warning, oldCritical, newCritical]).map(p => p.fingerprint)).toEqual(['b', 'a', 'c'])
  })
})
