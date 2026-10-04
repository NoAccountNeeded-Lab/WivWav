import { describe, expect, it } from 'vitest'
import {
  buildHelmQuery, clearSelection, EMPTY_SELECTION, focusAncestor, logKey, parseHelmLocation, parseRunRef,
  selectLog, selectProblem, selectRun, selectSource,
} from './helm-url'

const parse = (query: string) => parseHelmLocation(new URLSearchParams(query))

describe('helm-url', () => {
  it('defaults to the overview with no selection', () => {
    expect(parse('')).toEqual({ section: 'overview', selection: EMPTY_SELECTION })
    expect(parse('section=bogus').section).toBe('overview')
  })

  it('round-trips a problem → source → run → log chain', () => {
    const problem = selectProblem('domain:source_error:source:s1', 's1')
    const run = selectRun(problem, 'scrape:r9')
    const log = selectLog(run, logKey({ ts: '2026-10-04T10:00:00Z', jobId: 'j1', requestId: null }))
    const query = buildHelmQuery({ section: 'problems', selection: log })
    const parsed = parse(query.slice(1))
    expect(parsed.section).toBe('problems')
    expect(parsed.selection).toEqual(log)
    expect(parsed.selection.focus).toBe('log')
    expect(parsed.selection.problem).toBe('domain:source_error:source:s1')
  })

  it('keeps an explicit non-deepest focus in the URL', () => {
    const chain = selectRun(selectProblem('p', 's1'), 'job:abc')
    const atProblem = { ...chain, focus: 'problem' as const }
    expect(parse(buildHelmQuery({ section: 'overview', selection: atProblem }).slice(1)).selection.focus).toBe('problem')
  })

  it('falls back to the deepest present level when focus points at an empty level', () => {
    expect(parse('source=s1&focus=run').selection.focus).toBe('source')
  })

  it('rejects run refs without a known namespace', () => {
    expect(parse('run=123').selection.run).toBeNull()
    expect(parseRunRef('job:42')).toEqual({ kind: 'job', id: '42' })
    expect(parseRunRef('scrape:')).toBeNull()
  })

  it('selecting a different source drops the old run and log but selecting the same one keeps them', () => {
    const chain = selectLog(selectRun(selectProblem('p', 's1'), 'scrape:r1'), 'k')
    expect(selectSource(chain, 's1')).toMatchObject({ problem: 'p', run: 'scrape:r1', log: 'k', focus: 'source' })
    expect(selectSource(chain, 's2')).toMatchObject({ problem: null, run: null, log: null, source: 's2' })
  })

  it('breadcrumb focus drops deeper levels', () => {
    const chain = selectLog(selectRun(selectProblem('p', 's1'), 'scrape:r1'), 'k')
    expect(focusAncestor(chain, 'source')).toEqual({ problem: 'p', source: 's1', run: null, log: null, focus: 'source' })
    expect(clearSelection().focus).toBeNull()
  })
})
