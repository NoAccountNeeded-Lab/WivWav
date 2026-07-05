import { describe, expect, it } from 'vitest'
import {
  TIMELINE_WINDOW_MS,
  buildScheduleTimelineModel,
  positionOnTimeline,
  variantForStatus,
  type ScheduleTimelineInput,
} from './schedule-timeline-model'

const NOW = Date.parse('2026-07-05T12:00:00.000Z')

function entry(overrides: Partial<ScheduleTimelineInput> = {}): ScheduleTimelineInput {
  return {
    id: 'job-1',
    label: 'Job 1',
    enabled: true,
    next: null,
    lastRunAt: null,
    lastStatus: null,
    ...overrides,
  }
}

describe('variantForStatus', () => {
  it('should map failed to danger', () => {
    expect(variantForStatus('failed')).toBe('danger')
  })

  it('should map active to success', () => {
    expect(variantForStatus('active')).toBe('success')
  })

  it('should map completed to neutral', () => {
    expect(variantForStatus('completed')).toBe('neutral')
  })

  it('should map null to neutral', () => {
    expect(variantForStatus(null)).toBe('neutral')
  })
})

describe('positionOnTimeline', () => {
  it('should place now at the center of the axis', () => {
    expect(positionOnTimeline(NOW, NOW)).toEqual({ pct: 50, overflow: null })
  })

  it('should place the window start at 0% without overflow', () => {
    expect(positionOnTimeline(NOW - TIMELINE_WINDOW_MS, NOW)).toEqual({ pct: 0, overflow: null })
  })

  it('should place the window end at 100% without overflow', () => {
    expect(positionOnTimeline(NOW + TIMELINE_WINDOW_MS, NOW)).toEqual({ pct: 100, overflow: null })
  })

  it('should clamp and flag timestamps before the window', () => {
    expect(positionOnTimeline(NOW - TIMELINE_WINDOW_MS - 1000, NOW)).toEqual({ pct: 0, overflow: 'before' })
  })

  it('should clamp and flag timestamps after the window', () => {
    expect(positionOnTimeline(NOW + TIMELINE_WINDOW_MS + 1000, NOW)).toEqual({ pct: 100, overflow: 'after' })
  })

  it('should interpolate a timestamp between now and the window end', () => {
    const twelveHoursOut = NOW + TIMELINE_WINDOW_MS / 2
    expect(positionOnTimeline(twelveHoursOut, NOW)).toEqual({ pct: 75, overflow: null })
  })
})

describe('buildScheduleTimelineModel', () => {
  it('should return an empty row list for no entries', () => {
    const model = buildScheduleTimelineModel([], NOW)
    expect(model.rows).toEqual([])
  })

  it('should keep nowPct and ticks constant regardless of input', () => {
    const model = buildScheduleTimelineModel([entry()], NOW)
    expect(model.nowPct).toBe(50)
    expect(model.ticks.map((t) => t.label)).toEqual(['-24h', '-12h', 'Now', '+12h', '+24h'])
  })

  it('should position an enabled job\'s next run', () => {
    const model = buildScheduleTimelineModel([entry({ next: NOW })], NOW)
    expect(model.rows[0]?.next).toEqual({ pct: 50, overflow: null })
  })

  it('should not position a next run for a disabled job even if next is set', () => {
    const model = buildScheduleTimelineModel([entry({ enabled: false, next: NOW })], NOW)
    expect(model.rows[0]?.next).toBeNull()
  })

  it('should leave next null when the job has no scheduled run', () => {
    const model = buildScheduleTimelineModel([entry({ next: null })], NOW)
    expect(model.rows[0]?.next).toBeNull()
  })

  it('should position lastRunAt independent of enabled state', () => {
    const model = buildScheduleTimelineModel(
      [entry({ enabled: false, lastRunAt: new Date(NOW).toISOString() })],
      NOW,
    )
    expect(model.rows[0]?.lastRun).toEqual({ pct: 50, overflow: null })
  })

  it('should color a failed job\'s row danger', () => {
    const model = buildScheduleTimelineModel([entry({ lastStatus: 'failed' })], NOW)
    expect(model.rows[0]?.variant).toBe('danger')
  })

  it('should sort enabled jobs by soonest next run first', () => {
    const soon = entry({ id: 'soon', next: NOW + 1_000 })
    const later = entry({ id: 'later', next: NOW + 10_000 })
    const model = buildScheduleTimelineModel([later, soon], NOW)
    expect(model.rows.map((r) => r.id)).toEqual(['soon', 'later'])
  })

  it('should sort disabled and unscheduled jobs after all scheduled jobs', () => {
    const scheduled = entry({ id: 'scheduled', next: NOW + 1_000 })
    const disabled = entry({ id: 'disabled', enabled: false })
    const model = buildScheduleTimelineModel([disabled, scheduled], NOW)
    expect(model.rows.map((r) => r.id)).toEqual(['scheduled', 'disabled'])
  })
})
