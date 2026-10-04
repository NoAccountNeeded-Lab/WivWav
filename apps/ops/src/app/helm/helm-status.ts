import type { HelmSummary, ProblemSignalAvailability, ProblemState } from '@wivwav/types'
import { freshnessLabel, type Freshness } from './helm-freshness'
import { unacknowledgedProblems } from '../ops/problem-presentation'

export type HelmStatusLevel = 'critical' | 'warning' | 'unknown' | 'healthy'

export type HelmResourceKey = 'health' | 'queues' | 'sources' | 'runs' | 'problems' | 'summary'

export interface HelmStatusInput {
  freshness: Record<HelmResourceKey, Freshness>
  problems: ProblemState[] | null
  availability: ProblemSignalAvailability | null
  summary: HelmSummary | null
}

export interface HelmStatus {
  level: HelmStatusLevel
  label: string
  /** Why the level is not plain "healthy" — also shown as text so status is never colour-only. */
  reasons: string[]
}

const RESOURCE_LABEL: Record<HelmResourceKey, string> = {
  health: 'Service health',
  queues: 'Queues',
  sources: 'Sources',
  runs: 'Scrape runs',
  problems: 'Problem aggregate',
  summary: 'Inventory summary',
}

/** Observability gaps that stop us from honestly saying "healthy". */
export function observabilityGaps(input: HelmStatusInput): string[] {
  const gaps: string[] = []
  for (const key of Object.keys(RESOURCE_LABEL) as HelmResourceKey[]) {
    const freshness = input.freshness[key]
    if (freshness !== 'fresh') gaps.push(`${RESOURCE_LABEL[key]}: ${freshnessLabel(freshness).toLowerCase()}`)
  }
  if (input.availability) {
    for (const [signal, state] of Object.entries(input.availability)) {
      if (state === 'unavailable') gaps.push(`Signal ${signal} unavailable`)
    }
  }
  if (input.summary) {
    if (input.summary.availability.database === 'unavailable') gaps.push('Inventory database readings unavailable')
    if (input.summary.availability.search === 'unavailable') gaps.push('Search index reading unavailable')
  }
  return gaps
}

/**
 * Overall workspace status. "Healthy" requires every resource fresh, every
 * problem signal available and no open problems — absence of evidence is
 * reported as unknown, never as healthy. Open problems still win over
 * unknown (they are real), but the gaps stay listed as reasons.
 */
export function computeHelmStatus(input: HelmStatusInput): HelmStatus {
  const gaps = observabilityGaps(input)
  const open = input.problems ? unacknowledgedProblems(input.problems) : []
  const critical = open.filter(problem => problem.severity === 'critical').length
  const warning = open.filter(problem => problem.severity === 'warning').length

  if (critical > 0) {
    return { level: 'critical', label: `${critical} critical ${critical === 1 ? 'problem' : 'problems'}`, reasons: gaps }
  }
  if (warning > 0) {
    return { level: 'warning', label: `${warning} ${warning === 1 ? 'warning' : 'warnings'}`, reasons: gaps }
  }
  if (gaps.length > 0) {
    return { level: 'unknown', label: 'Status unknown', reasons: gaps }
  }
  return { level: 'healthy', label: 'No open problems', reasons: [] }
}
