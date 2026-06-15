import { describe, expect, it } from 'vitest'
import { validateIssueForStart, validateBranchName, mergeResults, formatResult } from '../lib/validation.js'
import type { IssueData } from '../lib/github.js'

function makeIssue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 42,
    title: 'feat(api): add listing search endpoint',
    body: '## Acceptance Criteria\n- [ ] GET /listings returns paginated results\n- [ ] supports q param',
    state: 'OPEN',
    labels: [{ name: 'status:ready' }],
    ...overrides,
  }
}

describe('validateIssueForStart', () => {
  it('passes a well-formed ready issue', () => {
    const result = validateIssueForStart(makeIssue())
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails when issue is closed', () => {
    const result = validateIssueForStart(makeIssue({ state: 'CLOSED' }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('not open'))).toBe(true)
  })

  it('fails when issue is already in-progress', () => {
    const result = validateIssueForStart(
      makeIssue({ labels: [{ name: 'status:in-progress' }] }),
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('already labeled'))).toBe(true)
  })

  it('fails when body has no acceptance criteria', () => {
    const result = validateIssueForStart(makeIssue({ body: 'Do the thing.' }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('acceptance criteria'))).toBe(true)
  })

  it('passes when body uses "Done when" phrasing', () => {
    const result = validateIssueForStart(
      makeIssue({ body: 'Done when: users can search by zip code.' }),
    )
    expect(result.ok).toBe(true)
  })

  it('warns when issue lacks status:ready label (but is not in-progress)', () => {
    const result = validateIssueForStart(makeIssue({ labels: [] }))
    // Should pass (no hard error) but emit a warning
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('not labeled status:ready'))).toBe(true)
  })
})

describe('validateBranchName', () => {
  it('accepts a well-formed feat branch', () => {
    const result = validateBranchName('feat/issue-42-add-listing-search', 42)
    expect(result.ok).toBe(true)
  })

  it('accepts a fix branch', () => {
    const result = validateBranchName('fix/issue-42-correct-price-calc', 42)
    expect(result.ok).toBe(true)
  })

  it('rejects a branch without a valid prefix', () => {
    const result = validateBranchName('issue-42-something', 42)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('must start with'))).toBe(true)
  })

  it('rejects a branch that does not include the issue number', () => {
    const result = validateBranchName('feat/issue-99-other-thing', 42)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('/issue-42-'))).toBe(true)
  })

  it('accepts a branch where issue number is followed by end of string', () => {
    // Edge case: "feat/issue-42" with no slug (technically minimal)
    const result = validateBranchName('feat/issue-42', 42)
    expect(result.ok).toBe(true)
  })
})

describe('formatResult', () => {
  it('returns an empty string when there are no errors or warnings', () => {
    expect(formatResult({ ok: true, errors: [], warnings: [] })).toBe('')
  })

  it('prefixes errors with [ERROR]', () => {
    const output = formatResult({ ok: false, errors: ['bad input'], warnings: [] })
    expect(output).toContain('[ERROR]')
    expect(output).toContain('bad input')
  })

  it('prefixes warnings with [WARNING]', () => {
    const output = formatResult({ ok: true, errors: [], warnings: ['heads up'] })
    expect(output).toContain('[WARNING]')
    expect(output).toContain('heads up')
  })

  it('includes both errors and warnings when both are present', () => {
    const output = formatResult({
      ok: false,
      errors: ['critical error'],
      warnings: ['minor warning'],
    })
    expect(output).toContain('[ERROR]')
    expect(output).toContain('critical error')
    expect(output).toContain('[WARNING]')
    expect(output).toContain('minor warning')
  })

  it('lists errors before warnings', () => {
    const output = formatResult({
      ok: false,
      errors: ['err'],
      warnings: ['warn'],
    })
    expect(output.indexOf('[ERROR]')).toBeLessThan(output.indexOf('[WARNING]'))
  })
})

describe('mergeResults', () => {
  it('merges multiple results — ok only when all pass', () => {
    const a = { ok: true, errors: [], warnings: ['warn-a'] }
    const b = { ok: false, errors: ['err-b'], warnings: [] }
    const merged = mergeResults(a, b)
    expect(merged.ok).toBe(false)
    expect(merged.errors).toEqual(['err-b'])
    expect(merged.warnings).toEqual(['warn-a'])
  })

  it('returns ok when all results pass', () => {
    const a = { ok: true, errors: [], warnings: [] }
    const b = { ok: true, errors: [], warnings: [] }
    expect(mergeResults(a, b).ok).toBe(true)
  })
})
