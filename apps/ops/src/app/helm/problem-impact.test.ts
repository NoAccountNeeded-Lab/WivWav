import { describe, expect, it } from 'vitest'
import { briefProblem } from './problem-impact'
import { problem, source } from './fixtures'

const ctx = (sources = [source()]) => ({ health: null, sources })

describe('briefProblem', () => {
  it('ties source_error to its source with a known impact', () => {
    const brief = briefProblem(problem(), ctx())
    expect(brief.scope).toMatchObject({ kind: 'source', sourceId: 's1', sourceName: 'BLVD' })
    expect(brief.impact.known).toBe(true)
    expect(brief.impact.text).toMatch(/120 stored listings/)
  })

  it('keeps global enrichment problems global with no source id', () => {
    const brief = briefProblem(problem({ fingerprint: 'domain:geocode_failed:queue:geocode', evidenceId: 'queue:geocode' }), ctx())
    expect(brief.scope.kind).toBe('global')
    expect(brief.scope.sourceId).toBeNull()
    expect(brief.scope.label).toMatch(/Global/)
  })

  it('says impact is unknown for problem types without an impact model', () => {
    const brief = briefProblem(problem({ source: 'sentry', fingerprint: 'sentry:1', evidenceId: '1', detail: 'TypeError' }), ctx())
    expect(brief.impact.known).toBe(false)
    expect(brief.impact.text).toMatch(/^Impact unknown/)
    expect(brief.scope.label).toMatch(/Scope unknown/)
  })

  it('does not invent a listing count when the source list is not loaded', () => {
    const brief = briefProblem(problem(), { health: null, sources: null })
    expect(brief.impact.text).toMatch(/affected listing count is unknown/)
  })
})
