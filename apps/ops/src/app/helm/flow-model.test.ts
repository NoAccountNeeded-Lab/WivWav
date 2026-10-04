import { describe, expect, it } from 'vitest'
import { buildBacklogRows, buildFlowStages, buildRecentRunWindow } from './flow-model'
import type { QueueRow } from '../ops/overview-helpers'

const q = (name: string, stats: Partial<QueueRow['stats']> = {}, paused = false): QueueRow => ({
  name, paused, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, ...stats },
})

describe('buildFlowStages', () => {
  it('marks every stage unavailable (not idle) when queues did not load', () => {
    for (const stage of buildFlowStages(null)) {
      expect(stage.state).toBe('unavailable')
      expect(stage.work).toBeNull()
    }
  })

  it('sums work and failures per stage and lists unreported queues instead of counting them as zero', () => {
    const stages = buildFlowStages([q('detail-crawl', { waiting: 3, active: 1, failed: 2 }), q('source-scrape')])
    const detail = stages.find(stage => stage.definition.id === 'detail')
    expect(detail).toMatchObject({ state: 'exceptions', work: 4, failed: 2, missingQueues: ['detail-extract'] })
    expect(stages.find(stage => stage.definition.id === 'discovery')?.state).toBe('idle')
    expect(stages.find(stage => stage.definition.id === 'search')?.state).toBe('unavailable')
  })

  it('prefers exceptions over paused over working', () => {
    expect(buildFlowStages([q('source-scrape', { waiting: 2 }, true)])[0]?.state).toBe('paused')
    expect(buildFlowStages([q('source-scrape', { waiting: 2 })])[0]?.state).toBe('working')
  })
})

describe('buildBacklogRows', () => {
  it('returns null when unavailable, drops empty queues and sorts by backlog', () => {
    expect(buildBacklogRows(null)).toBeNull()
    expect(buildBacklogRows([q('a'), q('b', { waiting: 1 }), q('c', { waiting: 2, delayed: 5 })])?.map(row => [row.queue, row.total])).toEqual([['c', 7], ['b', 1]])
  })
})

describe('buildRecentRunWindow', () => {
  const run = (id: string, startedAt: string) => ({ sourceId: id, sourceName: id, startedAt, success: true, listingsFound: 5 })

  it('returns the newest N oldest-first and labels the window', () => {
    const runs = [run('c', '2026-10-04T12:00:00Z'), run('b', '2026-10-04T11:00:00Z'), run('a', '2026-10-04T10:00:00Z')]
    const window = buildRecentRunWindow(runs, 2)
    expect(window?.points.map(point => point.label.split(' ')[0])).toEqual(['b', 'c'])
    expect(window?.windowLabel).toMatch(/Latest 2 of the 3 most recent scrape runs across all sources/)
  })

  it('is null when runs are unavailable', () => {
    expect(buildRecentRunWindow(null, 5)).toBeNull()
  })
})
