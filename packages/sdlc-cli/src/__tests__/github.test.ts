import { describe, expect, it } from 'vitest'
import { labelNames, hasAcceptanceCriteria, shellQuote, CliError } from '../lib/github.js'
import type { IssueData } from '../lib/github.js'

function makeIssue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 1,
    title: 'feat: add feature',
    body: '',
    state: 'OPEN',
    labels: [],
    ...overrides,
  }
}

describe('labelNames', () => {
  it('returns an empty array when the issue has no labels', () => {
    expect(labelNames(makeIssue({ labels: [] }))).toEqual([])
  })

  it('returns the names of all labels', () => {
    const issue = makeIssue({
      labels: [{ name: 'status:ready' }, { name: 'priority:high' }],
    })
    expect(labelNames(issue)).toEqual(['status:ready', 'priority:high'])
  })

  it('preserves label order', () => {
    const issue = makeIssue({
      labels: [{ name: 'c' }, { name: 'a' }, { name: 'b' }],
    })
    expect(labelNames(issue)).toEqual(['c', 'a', 'b'])
  })
})

describe('hasAcceptanceCriteria', () => {
  it('returns false for an empty body', () => {
    expect(hasAcceptanceCriteria('')).toBe(false)
  })

  it('returns false for a blank-whitespace body', () => {
    expect(hasAcceptanceCriteria('   ')).toBe(false)
  })

  it('returns false when body has no criteria section', () => {
    expect(hasAcceptanceCriteria('Do the thing.')).toBe(false)
  })

  it('returns true when body contains "acceptance criteria"', () => {
    expect(hasAcceptanceCriteria('## Acceptance Criteria\n- GET /listings returns results')).toBe(
      true,
    )
  })

  it('is case-insensitive for "acceptance criteria"', () => {
    expect(hasAcceptanceCriteria('ACCEPTANCE CRITERIA: done when tested')).toBe(true)
  })

  it('returns true when body contains "done when"', () => {
    expect(hasAcceptanceCriteria('Done when: users can search by zip code.')).toBe(true)
  })

  it('is case-insensitive for "done when"', () => {
    expect(hasAcceptanceCriteria('DONE WHEN users log in')).toBe(true)
  })

  it('returns true when body contains a markdown task-list item', () => {
    expect(hasAcceptanceCriteria('- [ ] implement endpoint')).toBe(true)
  })

  it('returns true for a checked task-list item', () => {
    expect(hasAcceptanceCriteria('- [x] implement endpoint')).toBe(true)
  })

  it('returns false for body with unrelated bullet points (no checkbox)', () => {
    expect(hasAcceptanceCriteria('- some plain bullet\n- another')).toBe(false)
  })
})

describe('shellQuote', () => {
  it('wraps a simple argument in single quotes', () => {
    expect(shellQuote('hello world')).toBe("'hello world'")
  })

  it('escapes embedded single quotes using POSIX-safe quoting', () => {
    expect(shellQuote("don't stop")).toBe("'don'\\''t stop'")
  })

  it('does not use bash-only ANSI C quoting', () => {
    expect(shellQuote('line one\nline two')).not.toMatch(/^\$'/)
  })
})

describe('CliError', () => {
  it('is an instance of Error', () => {
    const err = new CliError('something went wrong')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name "CliError"', () => {
    const err = new CliError('something went wrong')
    expect(err.name).toBe('CliError')
  })

  it('carries the provided message', () => {
    const err = new CliError('custom message')
    expect(err.message).toBe('custom message')
  })

  it('can be caught as an Error', () => {
    expect(() => {
      throw new CliError('test throw')
    }).toThrow(Error)
  })
})
