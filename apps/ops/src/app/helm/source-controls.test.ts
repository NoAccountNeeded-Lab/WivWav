import { describe, expect, it } from 'vitest'
import { sourceControlState } from './source-controls'
import type { SourceRow } from '../ops/overview-helpers'

const source = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: 's1', name: 'BLVD', status: 'error', lastScrapedAt: null, lastFullCrawlAt: null, lastObservedAt: null, listingCount: 10, errorMessage: 'x', possiblyGoneCount: 0, ...over,
})

describe('sourceControlState', () => {
  it('enables for an identified executable source, including one in error', () => {
    expect(sourceControlState('s1', [source()], 'fresh')).toEqual({ enabled: true, reason: null })
  })

  it.each([
    ['global problem', () => sourceControlState('s1', [source()], 'fresh', true), /global/],
    ['no source id', () => sourceControlState(null, [source()], 'fresh'), /No source is identified/],
    ['sources loading', () => sourceControlState('s1', null, 'loading'), /still loading/],
    ['sources unavailable', () => sourceControlState('s1', null, 'unavailable'), /unavailable/],
    ['unknown source', () => sourceControlState('zzz', [source()], 'fresh'), /not in the loaded source list/],
    ['paused', () => sourceControlState('s1', [source({ status: 'paused' })], 'fresh'), /paused and cannot be run/],
    ['disabled', () => sourceControlState('s1', [source({ status: 'disabled' })], 'fresh'), /disabled and cannot be run/],
  ])('disables with a reason: %s', (_name, run, pattern) => {
    const state = run()
    expect(state.enabled).toBe(false)
    expect(state.reason).toMatch(pattern)
  })
})
