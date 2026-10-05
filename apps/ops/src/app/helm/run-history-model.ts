import type { RunRow } from '../ops/overview-helpers'

/** `/admin/runs` returns at most this many runs, newest first, across every source. No older scrape history is read. */
export const RUN_HISTORY_LIMIT = 100

export type RunResult = 'failed' | 'succeeded' | 'unknown'

export function runResult(run: Pick<RunRow, 'success'>): RunResult {
  return run.success === true ? 'succeeded' : run.success === false ? 'failed' : 'unknown'
}

export interface SourceRunHistory {
  sourceId: string
  name: string
  failed: number
  succeeded: number
  /** No recorded result: still running or never reported. */
  unknown: number
  /** Runs for this source, oldest first. */
  runs: RunRow[]
  latest: RunRow
}

export interface RunHistoryModel {
  sources: SourceRunHistory[]
  total: number
  failed: number
  succeeded: number
  unknown: number
  /** True when the API returned a full page, so older runs may exist that are not shown. */
  truncated: boolean
  windowLabel: string
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

/** `runs` null means unavailable. Sources are ranked failures first, then most recent activity. */
export function buildRunHistory(runs: RunRow[] | null): RunHistoryModel | null {
  if (runs === null) return null
  const bySource = new Map<string, RunRow[]>()
  for (const run of runs) bySource.set(run.sourceId, [...(bySource.get(run.sourceId) ?? []), run])
  const sources = [...bySource.entries()]
    .map(([sourceId, list]): SourceRunHistory => {
      const ordered = [...list].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      const latest = ordered[ordered.length - 1] as RunRow
      return {
        sourceId,
        name: latest.sourceName ?? sourceId,
        failed: ordered.filter(run => runResult(run) === 'failed').length,
        succeeded: ordered.filter(run => runResult(run) === 'succeeded').length,
        unknown: ordered.filter(run => runResult(run) === 'unknown').length,
        runs: ordered,
        latest,
      }
    })
    .sort((a, b) => b.failed - a.failed || Date.parse(b.latest.startedAt) - Date.parse(a.latest.startedAt) || a.name.localeCompare(b.name))
  const times = runs.map(run => Date.parse(run.startedAt)).sort((a, b) => a - b)
  const first = times[0]
  const last = times[times.length - 1]
  const truncated = runs.length >= RUN_HISTORY_LIMIT
  const range = first !== undefined && last !== undefined ? `, started ${stamp(first)} to ${stamp(last)} UTC` : ''
  return {
    sources,
    total: runs.length,
    failed: sources.reduce((sum, source) => sum + source.failed, 0),
    succeeded: sources.reduce((sum, source) => sum + source.succeeded, 0),
    unknown: sources.reduce((sum, source) => sum + source.unknown, 0),
    truncated,
    windowLabel: `The ${runs.length} most recent scrape runs across all sources${range}${truncated ? `. The API returns at most ${RUN_HISTORY_LIMIT} runs, so older runs are not shown` : ''}`,
  }
}

export function sourceRunText(source: Pick<SourceRunHistory, 'failed' | 'succeeded' | 'unknown'>): string {
  const parts = [`${source.failed} failed`, `${source.succeeded} succeeded`]
  if (source.unknown > 0) parts.push(`${source.unknown} no result`)
  return parts.join(' · ')
}

export function listingsFoundText(run: Pick<RunRow, 'listingsFound'>): string {
  return run.listingsFound === null ? 'not reported' : run.listingsFound.toLocaleString()
}
