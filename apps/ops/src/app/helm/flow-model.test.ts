import { describe, expect, it } from 'vitest'
import { buildFlowStages } from './flow-model'
import type { QueueRow } from '../ops/overview-helpers'

const q = (name: string, stats: Partial<QueueRow['stats']> = {}, paused = false): QueueRow => ({
  name, paused, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, ...stats },
})

describe('buildFlowStages', () => {
  it('marks every stage unavailable (not idle) when queues did not load', () => {
    for (const stage of buildFlowStages(null)) {
      expect(stage.state).toBe('unavailable')
      expect(stage.ready).toBeNull()
    }
  })

  it('sums work and failures per stage and lists unreported queues instead of counting them as zero', () => {
    const stages = buildFlowStages([q('detail-crawl', { waiting: 3, active: 1, failed: 2 }), q('source-scrape')])
    const detail = stages.find(stage => stage.definition.id === 'detail')
    expect(detail).toMatchObject({ state: 'exceptions', ready: 4, delayed: 0, failed: 2, missingQueues: ['detail-extract'] })
    expect(stages.find(stage => stage.definition.id === 'discovery')?.state).toBe('idle')
    expect(stages.find(stage => stage.definition.id === 'search')?.state).toBe('unavailable')
  })

  it('a partial queue report is unavailable, never idle or working, and keeps the reported work', () => {
    const idle = buildFlowStages([q('geocode')]).find(stage => stage.definition.id === 'enrichment')
    expect(idle).toMatchObject({ state: 'unavailable', ready: 0, failed: 0 })
    expect(idle?.missingQueues).toEqual(['vin-enrich', 'deduplicate', 'dealer-enrich', 'listing-resolve'])
    const busy = buildFlowStages([q('geocode', { waiting: 5 })]).find(stage => stage.definition.id === 'enrichment')
    expect(busy).toMatchObject({ state: 'unavailable', ready: 5 })
  })

  it('prefers exceptions over paused over working', () => {
    expect(buildFlowStages([q('source-scrape', { waiting: 2 }, true)])[0]?.state).toBe('paused')
    expect(buildFlowStages([q('source-scrape', { waiting: 2 })])[0]?.state).toBe('working')
  })
})

it('keeps delayed jobs out of ready work, so one retry does not make a stage busy', () => {
  const discovery = buildFlowStages([q('source-scrape', { delayed: 1 })])[0]
  expect(discovery).toMatchObject({ state: 'idle', ready: 0, delayed: 1 })
})
