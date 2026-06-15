import { describe, expect, it } from 'vitest'
import {
  isProtectedBranch,
  expectedPrefix,
  issueNumberFromBranch,
  tryRun,
  changedFiles,
  stagedFiles,
  dirtyFiles,
} from '../lib/git.js'

describe('isProtectedBranch', () => {
  it('returns true for main', () => {
    expect(isProtectedBranch('main')).toBe(true)
  })

  it('returns true for master', () => {
    expect(isProtectedBranch('master')).toBe(true)
  })

  it('returns false for a feature branch', () => {
    expect(isProtectedBranch('feat/issue-42-add-search')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isProtectedBranch('')).toBe(false)
  })

  it('returns false for main-like names that are not exact matches', () => {
    expect(isProtectedBranch('main-backup')).toBe(false)
    expect(isProtectedBranch('feature/main')).toBe(false)
  })
})

describe('expectedPrefix', () => {
  it('returns fix for titles starting with "fix"', () => {
    expect(expectedPrefix('fix: correct price calc')).toBe('fix')
    expect(expectedPrefix('Fix typo in README')).toBe('fix')
  })

  it('returns fix for titles starting with "bug"', () => {
    expect(expectedPrefix('bug: geocode fails on retry')).toBe('fix')
    expect(expectedPrefix('Bug report: null pointer')).toBe('fix')
  })

  it('returns docs for titles starting with "doc"', () => {
    expect(expectedPrefix('docs: update API reference')).toBe('docs')
    expect(expectedPrefix('Document the auth flow')).toBe('docs')
  })

  it('returns chore for titles starting with "chore"', () => {
    expect(expectedPrefix('chore(ci): upgrade turbo')).toBe('chore')
    expect(expectedPrefix('Chore: clean up scripts')).toBe('chore')
  })

  it('returns chore for titles starting with "refactor"', () => {
    expect(expectedPrefix('refactor(api): extract helpers')).toBe('chore')
  })

  it('returns feat as default for unrecognised titles', () => {
    expect(expectedPrefix('Add new listing page')).toBe('feat')
    expect(expectedPrefix('feat(web): new page')).toBe('feat')
    expect(expectedPrefix('')).toBe('feat')
  })
})

describe('issueNumberFromBranch', () => {
  it('extracts the issue number from a standard branch name', () => {
    expect(issueNumberFromBranch('feat/issue-304-add-sdlc-cli')).toBe(304)
  })

  it('extracts the issue number from a fix branch', () => {
    expect(issueNumberFromBranch('fix/issue-99-correct-price')).toBe(99)
  })

  it('is case-insensitive', () => {
    expect(issueNumberFromBranch('feat/ISSUE-7-something')).toBe(7)
  })

  it('returns null when there is no issue segment', () => {
    expect(issueNumberFromBranch('main')).toBeNull()
    expect(issueNumberFromBranch('feat/add-feature')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(issueNumberFromBranch('')).toBeNull()
  })
})

describe('tryRun', () => {
  it('returns ok:true and stdout for a succeeding command', () => {
    const result = tryRun('echo hello')
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('hello')
  })

  it('returns ok:false for a failing command', () => {
    const result = tryRun('exit 1')
    expect(result.ok).toBe(false)
  })

  it('captures stderr for a failing command', () => {
    const result = tryRun('node -e "console.error(\'stderr only\'); process.exit(1)"')
    expect(result.ok).toBe(false)
    expect(result.stdout).toContain('stderr only')
  })

  it('returns ok:false for an unknown command', () => {
    const result = tryRun('__no_such_command_wivwav__ 2>/dev/null')
    expect(result.ok).toBe(false)
  })

  it('stdout is trimmed', () => {
    const result = tryRun('printf "  trimmed  "')
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('trimmed')
  })
})

describe('changedFiles', () => {
  it('returns an array (may be empty on a clean branch)', () => {
    const files = changedFiles()
    expect(Array.isArray(files)).toBe(true)
    // Every entry must be a non-empty string
    for (const f of files) {
      expect(typeof f).toBe('string')
      expect(f.length).toBeGreaterThan(0)
    }
  })
})

describe('stagedFiles', () => {
  it('returns an array of staged file paths', () => {
    const files = stagedFiles()
    expect(Array.isArray(files)).toBe(true)
    for (const f of files) {
      expect(typeof f).toBe('string')
      expect(f.length).toBeGreaterThan(0)
    }
  })
})

describe('dirtyFiles', () => {
  it('returns an array of dirty file paths', () => {
    const files = dirtyFiles()
    expect(Array.isArray(files)).toBe(true)
    for (const f of files) {
      expect(typeof f).toBe('string')
      expect(f.length).toBeGreaterThan(0)
    }
  })
})
