import type { ProblemState } from '@wivwav/types'
import { presentProblem, problemSourceId, type ProblemPresentation } from '../ops/problem-presentation'
import type { SourceRow } from '../ops/overview-helpers'
import type { HealthResponse } from '@wivwav/types'

export interface ProblemScope {
  /** `source` when tied to one source; `global` when it affects the whole pipeline or platform. */
  kind: 'source' | 'global'
  sourceId: string | null
  sourceName: string | null
  /** Plain-language scope line for the inspector. */
  label: string
}

export interface ProblemImpact {
  /** False means we have no impact model for this problem — shown explicitly, never hidden. */
  known: boolean
  text: string
}

export interface ProblemBrief {
  presentation: ProblemPresentation
  /** One plain sentence: what happened. */
  summary: string
  scope: ProblemScope
  impact: ProblemImpact
  nextAction: string
}

export function problemCode(problem: ProblemState): string {
  if (problem.source !== 'domain') return problem.source
  const withoutPrefix = problem.fingerprint.startsWith('domain:') ? problem.fingerprint.slice('domain:'.length) : problem.fingerprint
  const suffix = `:${problem.evidenceId}`
  return withoutPrefix.endsWith(suffix) ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix
}

const SUMMARY: Record<string, string> = {
  source_error: 'The last scrape of this source failed and the source is marked in error.',
  source_needs_remap: 'The source layout no longer matches its extraction mapping.',
  source_inventory_discrepancy: 'An unusually high share of this source’s listings are marked possibly gone.',
  service_unhealthy: 'A platform service is reporting down or degraded.',
  queue_failed_jobs: 'One or more queued jobs failed and are waiting for review.',
  queue_paused: 'One or more queues are paused, so their jobs are not running.',
  schedule_disabled: 'Recurring job schedules are disabled.',
  schedule_failed: 'Recurring jobs have recent failures.',
  scraper_no_successful_run: 'No successful scraper run has been recorded.',
  scraper_stale_run: 'The last successful scraper run is older than expected.',
  geocode_failed: 'Geocode jobs failed.',
  geocode_paused: 'The geocode queue is paused.',
}

const NEXT_ACTION: Record<string, string> = {
  source_error: 'Run the source now and confirm the next run succeeds; open the run tree and logs if it fails again.',
  source_needs_remap: 'Review the source mapping. Re-running will not fix a layout change.',
  source_inventory_discrepancy: 'Check the latest runs for this source to see whether listings really disappeared.',
  service_unhealthy: 'Check service health and logs for the affected service.',
  queue_failed_jobs: 'Review failed jobs in the queue console, then retry or clean them.',
  queue_paused: 'Resume the queue from the queue console once it is safe.',
  schedule_disabled: 'Re-enable the schedule if it was not turned off on purpose.',
  schedule_failed: 'Open the schedules page and review the recent failure reason.',
  scraper_no_successful_run: 'Run a source and check the run tree for the failure.',
  scraper_stale_run: 'Check the schedule and recent runs to see why scraping stopped.',
  geocode_failed: 'Review failed geocode jobs; this is a global enrichment issue, not a single source.',
  geocode_paused: 'Resume the geocode queue; this is a global enrichment issue.',
}

const GLOBAL_CODES = new Set([
  'service_unhealthy', 'queue_failed_jobs', 'queue_paused', 'schedule_disabled', 'schedule_failed',
  'scraper_no_successful_run', 'scraper_stale_run', 'geocode_failed', 'geocode_paused',
])

function impactFor(code: string, source: SourceRow | null, sourceId: string | null): ProblemImpact {
  const name = source?.name ?? (sourceId ? `Source ${sourceId}` : 'This source')
  switch (code) {
    case 'source_error':
      return {
        known: true,
        text: source
          ? `${name} may not be getting fresh listings. Its listings can go stale until a scrape succeeds. The source's listing counter reads ${source.listingCount.toLocaleString()}; that is a stored counter, not a count of affected vehicles.`
          : `${name} may not be getting fresh listings. Source details are not loaded, so the source's listing counter is unknown.`,
      }
    case 'source_needs_remap':
      return { known: true, text: `${name} cannot extract listings reliably until its mapping is repaired. Existing listings are not updated meanwhile.` }
    case 'source_inventory_discrepancy':
      return { known: true, text: `${name} may be losing listings from public results, or the source may have removed them.` }
    case 'queue_failed_jobs':
      return { known: true, text: 'Failed jobs are not retried automatically. The affected stage may be missing updates across several sources.' }
    case 'queue_paused':
      return { known: true, text: 'Work in the paused queues does not run. This is global, not tied to one source.' }
    case 'geocode_failed':
    case 'geocode_paused':
      return { known: true, text: 'Listings without coordinates may not appear on map results. This is global enrichment, not one source.' }
    default:
      return { known: false, text: 'Impact unknown: no impact model exists for this problem type. Check the evidence before assuming it is harmless.' }
  }
}

export function briefProblem(
  problem: ProblemState,
  context: { health: HealthResponse | null; sources: SourceRow[] | null },
): ProblemBrief {
  const presentation = presentProblem(problem, context)
  const code = problemCode(problem)
  const sourceId = problemSourceId(problem)
  const source = sourceId ? (context.sources?.find(row => row.id === sourceId) ?? null) : null
  const global = sourceId === null
  const scope: ProblemScope = global
    ? {
        kind: 'global',
        sourceId: null,
        sourceName: null,
        label: GLOBAL_CODES.has(code)
          ? 'Global: affects the platform or a shared pipeline stage, not a single source.'
          : 'Scope unknown: this problem is not tied to an identifiable source.',
      }
    : {
        kind: 'source',
        sourceId,
        sourceName: source?.name ?? null,
        label: source ? `Source: ${source.name}` : `Source ${sourceId} (not in the loaded source list)`,
      }
  return {
    presentation,
    summary: SUMMARY[code] ?? (problem.source === 'domain' ? presentation.detail : `Reported by ${problem.source}: ${problem.detail}`),
    scope,
    impact: impactFor(code, source, sourceId),
    nextAction: NEXT_ACTION[code] ?? 'Open the evidence and the linked surface to decide what to do.',
  }
}
