import type { HealthResponse, ProblemState, ServiceHealth } from '@wivwav/types'
import { serviceDetail, serviceLabel, serviceName, type SourceRow } from './overview-helpers'

export interface ProblemPresentationContext {
  health: HealthResponse | null
  sources: SourceRow[] | null
}

export interface ProblemPresentation {
  /** Short operator-facing headline for the problem. */
  title: string
  /** Factual detail — usually `problem.detail` verbatim. */
  detail: string
  /** Deep link to the problem's fix surface. */
  href: string
  /** True when `href` leaves the ops app (e.g. a Sentry issue permalink). */
  external: boolean
}

/** `{ code: titleSuffix }` for the three source-scoped domain condition
 *  codes — they differ only in this suffix, so one branch below builds all
 *  three instead of three near-identical copies. Ported from the pre-#892
 *  `mapAttentionCondition` in `overview-helpers.ts`, which no longer
 *  recomputes attention items from domain conditions directly (issue #892
 *  replaced that with the shared `useProblemAggregate` aggregate). */
const SOURCE_CODE_TITLE_SUFFIX: Record<string, string> = {
  source_needs_remap: 'needs remapping',
  source_error: 'source is in error',
  source_inventory_discrepancy: 'has a high possibly-gone count',
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1 }

/** True once an operator has acknowledged the problem (issue #892's
 *  acceptance criterion: acknowledging removes it from the default view
 *  without deleting history). */
export function isAcknowledged(problem: ProblemState): boolean {
  return problem.acknowledgedAt !== null
}

export function unacknowledgedProblems(problems: ProblemState[]): ProblemState[] {
  return problems.filter(problem => !isAcknowledged(problem))
}

/** Counts by severity, ignoring severities other than critical/warning
 *  (there currently are none — `AttentionSeverity` is exactly these two). */
export function problemCountsBySeverity(problems: ProblemState[]): { critical: number; warning: number } {
  return {
    critical: problems.filter(problem => problem.severity === 'critical').length,
    warning: problems.filter(problem => problem.severity === 'warning').length,
  }
}

/** Most severe and most recently seen first — the same ordering the
 *  overview's Attention panel preview and `/ops/problems`' full list both
 *  use, so the panel's top-N is always a strict prefix of the full list. */
export function sortProblems(problems: ProblemState[]): ProblemState[] {
  return [...problems].sort((a, b) => {
    const rank = (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2)
    if (rank !== 0) return rank
    return new Date(b.lastSeen ?? 0).getTime() - new Date(a.lastSeen ?? 0).getTime()
  })
}

/**
 * Maps one federated `Problem` (issue #890/#892) to display copy + a deep
 * link to its fix surface — the same presentation `mapAttentionCondition`
 * used to own for domain conditions, now shared by the overview's Attention
 * panel preview and the full `/ops/problems` list so neither builds its own
 * copy of this mapping.
 */
export function presentProblem(problem: ProblemState, context: ProblemPresentationContext): ProblemPresentation {
  if (problem.source === 'sentry') {
    return { title: problem.detail, detail: 'Reported by Sentry', href: problem.href ?? '/status', external: problem.href !== null }
  }
  if (problem.source === 'grafana') {
    return { title: problem.detail, detail: 'Grafana infrastructure alert', href: '/status', external: false }
  }

  return presentDomainProblem(domainCode(problem), problem, context)
}

/** Recovers the domain condition code from `domain:{code}:{evidenceId}` —
 *  `evidenceId` is stripped from the end rather than split naively, since
 *  `evidenceId` itself may contain `:` (e.g. `service:valkey`). */
function domainCode(problem: ProblemState): string {
  const withoutPrefix = problem.fingerprint.startsWith('domain:') ? problem.fingerprint.slice('domain:'.length) : problem.fingerprint
  const suffix = `:${problem.evidenceId}`
  return withoutPrefix.endsWith(suffix) ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix
}

function stripEvidencePrefix(evidenceId: string, prefix: string): string {
  return evidenceId.startsWith(`${prefix}:`) ? evidenceId.slice(prefix.length + 1) : evidenceId
}

function findSourceName(sources: SourceRow[] | null, id: string): string {
  return sources?.find(source => source.id === id)?.name ?? `Source ${id}`
}

function presentDomainProblem(code: string, problem: ProblemState, context: ProblemPresentationContext): ProblemPresentation {
  const titleSuffix = SOURCE_CODE_TITLE_SUFFIX[code]
  if (titleSuffix) {
    const id = stripEvidencePrefix(problem.evidenceId, 'source')
    return { title: `${findSourceName(context.sources, id)} ${titleSuffix}`, detail: problem.detail, href: '/ops/sources', external: false }
  }

  switch (code) {
    case 'service_unhealthy': {
      const name = stripEvidencePrefix(problem.evidenceId, 'service')
      // Look up the raw service health ops already holds (rather than
      // reformatting `problem.detail`) so the title/detail keep their exact
      // pre-#774 wording — e.g. "Database is down", not a generic "needs
      // attention" that loses the down/degraded/optional-offline distinction
      // the operator relied on.
      const service = (context.health?.services as Record<string, ServiceHealth> | undefined)?.[name] ?? null
      return {
        title: `${serviceName(name)} is ${serviceLabel(service).toLowerCase()}`,
        detail: service ? serviceDetail(service) : problem.detail,
        href: name === 'valkey' ? '/ops/queues' : '/status',
        external: false,
      }
    }
    case 'queue_failed_jobs':
      return { title: 'Failed jobs need review', detail: problem.detail, href: '/ops/queues', external: false }
    case 'queue_paused':
      return { title: 'Queues are paused', detail: problem.detail, href: '/ops/queues', external: false }
    case 'schedule_disabled':
      return { title: 'Schedules are disabled', detail: problem.detail, href: '/ops/schedules', external: false }
    case 'schedule_failed':
      return { title: 'Scheduled jobs have recent failures', detail: problem.detail, href: '/ops/schedules', external: false }
    case 'scraper_no_successful_run':
      return { title: 'No successful scraper run found', detail: problem.detail, href: '/ops/runs', external: false }
    case 'scraper_stale_run':
      return { title: 'Listings may be stale', detail: problem.detail, href: '/ops/runs', external: false }
    case 'geocode_failed':
      return { title: 'Geocode jobs failed', detail: problem.detail, href: '/ops/queues', external: false }
    case 'geocode_paused':
      return { title: 'Geocode queue is paused', detail: problem.detail, href: '/ops/queues', external: false }
    default:
      return { title: problem.detail, detail: problem.detail, href: '/status', external: false }
  }
}
