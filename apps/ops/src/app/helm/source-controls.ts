import type { Freshness } from './helm-freshness'
import type { SourceRow } from '../ops/overview-helpers'

export interface ControlState {
  enabled: boolean
  /** Why the control is disabled; null when enabled. Always shown as visible text. */
  reason: string | null
}

/**
 * Source-targeted controls (run now, detail crawl, extraction) apply only to
 * one identified, executable source. Mirrors the API: `POST
 * /admin/sources/:id/run` answers 409 for disabled or paused sources, and the
 * detail queues require a non-empty `sourceId`.
 */
export function sourceControlState(
  sourceId: string | null,
  sources: SourceRow[] | null,
  sourcesFreshness: Freshness,
  scopeIsGlobal = false,
): ControlState {
  if (scopeIsGlobal) return { enabled: false, reason: 'This problem is global and not tied to one source, so source controls do not apply.' }
  if (sourceId === null) return { enabled: false, reason: 'No source is identified. Select a source first.' }
  if (sources === null) {
    return { enabled: false, reason: sourcesFreshness === 'loading' ? 'Source list is still loading.' : 'Source list is unavailable, so the source cannot be verified.' }
  }
  const source = sources.find(row => row.id === sourceId)
  if (!source) return { enabled: false, reason: `Source ${sourceId} is not in the loaded source list.` }
  if (source.status === 'disabled' || source.status === 'paused') {
    return { enabled: false, reason: `${source.name} is ${source.status} and cannot be run.` }
  }
  return { enabled: true, reason: null }
}
