import { describe, expect, it } from 'vitest'
import type { QueueRow } from '../ops/overview-helpers'
import { buildQueueWork, queueLabel } from './queue-work-model'

const q = (name: string, stats: Partial<QueueRow['stats']> = {}, paused = false): QueueRow => ({
  name, paused, stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, ...stats },
})

const delayedOnly = Array.from({ length: 18 }, (_, index) => q(`maintenance-${index}`, { delayed: 1 }))
const mixed = [
  ...delayedOnly,
  q('detail-crawl', { waiting: 7, active: 1, failed: 2, delayed: 4 }),
  q('geocode', { waiting: 2 }),
  q('source-scrape'),
]

describe('buildQueueWork', () => {
  it('is null (unknown, not zero) when queue data is unavailable', () => {
    expect(buildQueueWork(null)).toBeNull()
  })

  it('ranks by waiting plus running and keeps 18 single delayed jobs out of the default rows', () => {
    const model = buildQueueWork(mixed)
    expect(model?.busy.map(row => row.queue)).toEqual(['detail-crawl', 'geocode'])
    expect(model?.delayedOnly).toHaveLength(18)
    expect(model?.rows).toHaveLength(21)
    expect(model?.totals).toEqual({ waiting: 9, running: 1, delayed: 22, failed: 2 })
  })

  it('keeps waiting, running and delayed distinct on a row', () => {
    const row = buildQueueWork(mixed)?.rows[0]
    expect(row).toMatchObject({ queue: 'detail-crawl', waiting: 7, running: 1, delayed: 4, failed: 2, label: 'Detail crawl' })
  })

  it('stage totals equal queue totals, with unmapped queues in an explicit Other bucket', () => {
    const model = buildQueueWork(mixed)!
    for (const key of ['waiting', 'running', 'delayed', 'failed'] as const) {
      expect(model.stages.reduce((sum, stage) => sum + stage[key], 0)).toBe(model.totals[key])
    }
    expect(model.stages.find(stage => stage.id === 'other')).toMatchObject({ queues: 18, delayed: 18, waiting: 0 })
  })

  it('flags a stage whose queues were not all reported as a lower bound', () => {
    const detail = buildQueueWork([q('detail-crawl', { waiting: 3 })])?.stages.find(stage => stage.id === 'detail')
    expect(detail).toMatchObject({ waiting: 3, missingQueues: ['detail-extract'] })
  })

  it('handles all-zero queues and omits the Other bucket when empty', () => {
    const model = buildQueueWork([q('source-scrape')])!
    expect(model.busy).toEqual([])
    expect(model.totals).toEqual({ waiting: 0, running: 0, delayed: 0, failed: 0 })
    expect(model.stages.some(stage => stage.id === 'other')).toBe(false)
  })

  it('uses plain labels and falls back to the raw name for unknown queues', () => {
    expect(queueLabel('detail-extract')).toBe('Detail extraction')
    expect(queueLabel('nhtsa-recalls')).toBe('nhtsa-recalls')
  })
})
