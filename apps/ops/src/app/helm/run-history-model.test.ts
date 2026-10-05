import { describe, expect, it } from 'vitest'
import type { RunRow } from '../ops/overview-helpers'
import { buildRunHistory, RUN_HISTORY_LIMIT } from './run-history-model'

const run = (id: string, sourceId: string, startedAt: string, success: boolean | null, listingsFound: number | null = 5): RunRow => ({
  id, sourceId, sourceName: sourceId.toUpperCase(), startedAt, finishedAt: null, success, listingsFound, listingsNew: null, listingsUpdated: null, errorMessage: null,
})

describe('buildRunHistory', () => {
  it('is null when runs are unavailable and has no sources when empty', () => {
    expect(buildRunHistory(null)).toBeNull()
    expect(buildRunHistory([])).toMatchObject({ total: 0, sources: [], truncated: false })
  })

  it('groups by source, ranks failing sources first and keeps runs oldest first', () => {
    const history = buildRunHistory([
      run('3', 'a', '2026-10-04T12:00:00Z', true),
      run('2', 'b', '2026-10-04T11:00:00Z', false),
      run('1', 'b', '2026-10-04T10:00:00Z', false),
      run('0', 'a', '2026-10-04T09:00:00Z', null, null),
    ])!
    expect(history.sources.map(source => [source.name, source.failed, source.succeeded, source.unknown])).toEqual([['B', 2, 0, 0], ['A', 0, 1, 1]])
    expect(history.sources[1]?.runs.map(item => item.id)).toEqual(['0', '3'])
    expect(history.sources[1]?.latest.id).toBe('3')
    expect(history).toMatchObject({ total: 4, failed: 2, succeeded: 1, unknown: 1 })
    expect(history.windowLabel).toMatch(/4 most recent scrape runs across all sources, started 2026-10-04 09:00 to 2026-10-04 12:00 UTC/)
  })

  it('says older runs are not shown when the API page is full', () => {
    const runs = Array.from({ length: RUN_HISTORY_LIMIT }, (_, index) => run(String(index), 'a', `2026-10-04T10:${String(index % 60).padStart(2, '0')}:00Z`, true))
    const history = buildRunHistory(runs)!
    expect(history.truncated).toBe(true)
    expect(history.windowLabel).toMatch(/older runs are not shown/)
  })
})
