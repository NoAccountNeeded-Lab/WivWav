import { describe, expect, it } from 'vitest'
import type { HelmSummary, ProblemSignalAvailability, ProblemState } from '@wivwav/types'
import { computeHelmStatus, type HelmStatusInput } from './helm-status'

const ALL_AVAILABLE: ProblemSignalAvailability = { health: 'available', bullmq: 'available', db: 'available', loki: 'available', grafana: 'available', sentry: 'available' }
const reading = { value: 1, availability: 'available' as const, collectedAt: '2026-10-04T10:00:00Z' }
const SUMMARY: HelmSummary = {
  collectedAt: '2026-10-04T10:00:00Z',
  counts: { stored: reading, active: reading, eligible: reading, indexed: reading },
  availability: { database: 'available', search: 'available' },
}
function problem(over: Partial<ProblemState> = {}): ProblemState {
  return { fingerprint: 'f', source: 'domain', severity: 'warning', detail: 'd', evidenceId: 'e', href: null, firstSeen: null, lastSeen: null, occurrenceCount: null, acknowledgedAt: null, acknowledgedBy: null, ...over }
}
function input(over: Partial<HelmStatusInput> = {}): HelmStatusInput {
  return {
    freshness: { health: 'fresh', queues: 'fresh', sources: 'fresh', runs: 'fresh', problems: 'fresh', summary: 'fresh' },
    problems: [], availability: ALL_AVAILABLE, summary: SUMMARY, ...over,
  }
}

describe('computeHelmStatus', () => {
  it('is healthy only when everything is fresh, available and problem-free', () => {
    expect(computeHelmStatus(input()).level).toBe('healthy')
  })

  it('is never healthy when the aggregate failed or is stale', () => {
    const status = computeHelmStatus(input({ freshness: { ...input().freshness, problems: 'unavailable' }, problems: null, availability: null }))
    expect(status.level).toBe('unknown')
    expect(status.reasons.join(' ')).toMatch(/Problem aggregate: unavailable/)
    expect(computeHelmStatus(input({ freshness: { ...input().freshness, problems: 'stale' } })).level).toBe('unknown')
  })

  it('is unknown when any problem signal is unavailable', () => {
    const status = computeHelmStatus(input({ availability: { ...ALL_AVAILABLE, grafana: 'unavailable' } }))
    expect(status.level).toBe('unknown')
    expect(status.reasons).toContain('Signal grafana unavailable')
  })

  it('is unknown when the summary reports search or database unavailable', () => {
    const down = { ...SUMMARY, availability: { database: 'available' as const, search: 'unavailable' as const } }
    expect(computeHelmStatus(input({ summary: down })).level).toBe('unknown')
  })

  it('reports open problems even while observability is degraded, but ignores acknowledged ones', () => {
    const open = computeHelmStatus(input({ problems: [problem({ severity: 'critical' })], availability: { ...ALL_AVAILABLE, loki: 'unavailable' } }))
    expect(open.level).toBe('critical')
    expect(open.reasons.length).toBeGreaterThan(0)
    expect(computeHelmStatus(input({ problems: [problem({ acknowledgedAt: '2026-10-04T10:00:00Z' })] })).level).toBe('healthy')
  })
})
