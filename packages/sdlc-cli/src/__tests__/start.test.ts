import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { slugify, deriveBranchPrefix, buildBranchName, sanitizeBranchName } from '../commands/start.js'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Add Listing Search')).toBe('add-listing-search')
  })

  it('strips special characters', () => {
    expect(slugify('fix: price calc! (v2)')).toBe('fix-price-calc-v2')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar')
  })

  it('truncates at 50 characters', () => {
    const long = 'a'.repeat(60)
    expect(slugify(long).length).toBeLessThanOrEqual(50)
  })

  it('does not end with a hyphen after truncation', () => {
    const title = 'feat add some really long description that goes on and on and on'
    const slug = slugify(title)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('deriveBranchPrefix', () => {
  it('returns feat for feature titles', () => {
    expect(deriveBranchPrefix('feat(api): add search')).toBe('feat')
    expect(deriveBranchPrefix('Add new listing page')).toBe('feat')
  })

  it('returns fix for bug/fix titles', () => {
    expect(deriveBranchPrefix('fix(web): correct price display')).toBe('fix')
    expect(deriveBranchPrefix('bug: geocode fails on retry')).toBe('fix')
  })

  it('returns docs for doc titles', () => {
    expect(deriveBranchPrefix('docs(agents): update workflow')).toBe('docs')
  })

  it('returns chore for chore/refactor titles', () => {
    expect(deriveBranchPrefix('chore(ci): upgrade turbo')).toBe('chore')
    expect(deriveBranchPrefix('refactor(api): extract route helpers')).toBe('chore')
  })
})

describe('buildBranchName', () => {
  it('produces the correct branch name format', () => {
    const name = buildBranchName(304, 'feat(agents): add repo-native SDLC CLI for issue start, review, and finish')
    expect(name).toMatch(/^feat\/issue-304-/)
    expect(name).not.toContain('feat(agents)')
  })

  it('uses fix prefix for fix issues', () => {
    const name = buildBranchName(99, 'fix(api): correct pagination offset')
    expect(name).toMatch(/^fix\/issue-99-/)
  })

  it('handles plain titles without conventional-commit prefix', () => {
    const name = buildBranchName(10, 'Add wheelchair listing page')
    expect(name).toMatch(/^feat\/issue-10-add-wheelchair/)
  })
})

describe('sanitizeBranchName', () => {
  it('passes through a safe branch name unchanged', () => {
    expect(sanitizeBranchName('feat/issue-42-add-search')).toBe('feat/issue-42-add-search')
  })

  it('strips shell metacharacters like $, (, ), spaces', () => {
    // slash is kept (valid in branch names); $ ( ) and space are stripped
    expect(sanitizeBranchName('feat/issue-42-evil$(rm -rf /)')).toBe('feat/issue-42-evilrm-rf/')
  })

  it('strips backticks', () => {
    expect(sanitizeBranchName('feat/issue-1-`whoami`')).toBe('feat/issue-1-whoami')
  })

  it('strips spaces', () => {
    expect(sanitizeBranchName('feat/issue-1-foo bar')).toBe('feat/issue-1-foobar')
  })

  it('allows dots and underscores', () => {
    expect(sanitizeBranchName('feat/issue-1-foo.bar_baz')).toBe('feat/issue-1-foo.bar_baz')
  })
})

// ---------------------------------------------------------------------------
// startCommand behavioural tests — external boundaries are mocked
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
}))

vi.mock('../lib/github.js', () => ({
  fetchIssue: vi.fn(),
  editIssueLabels: vi.fn(),
  postComment: vi.fn(),
  labelNames: vi.fn((issue: { labels: Array<{ name: string }> }) => issue.labels.map((l) => l.name)),
  extractAcceptanceCriteria: vi.fn(() => ['- [ ] GET /listings returns results']),
  CliError: class CliError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'CliError'
    }
  },
}))

vi.mock('../lib/git.js', () => ({
  run: vi.fn(),
  isDirty: vi.fn(() => false),
}))

vi.mock('../lib/validation.js', () => ({
  validateIssueForStart: vi.fn(() => ({ ok: true, errors: [], warnings: [] })),
  validateBranchName: vi.fn(() => ({ ok: true, errors: [], warnings: [] })),
  mergeResults: vi.fn((...results: { ok: boolean; errors: string[]; warnings: string[] }[]) => ({
    ok: results.every((r) => r.ok),
    errors: results.flatMap((r) => r.errors),
    warnings: results.flatMap((r) => r.warnings),
  })),
  formatResult: vi.fn(() => ''),
}))

import { startCommand } from '../commands/start.js'
import * as githubMod from '../lib/github.js'
import * as gitMod from '../lib/git.js'
import * as validationMod from '../lib/validation.js'
import * as fsMod from 'node:fs'

const mockFetchIssue = githubMod.fetchIssue as ReturnType<typeof vi.fn>
const mockEditIssueLabels = githubMod.editIssueLabels as ReturnType<typeof vi.fn>
const mockPostComment = githubMod.postComment as ReturnType<typeof vi.fn>
const mockRun = gitMod.run as ReturnType<typeof vi.fn>
const mockIsDirty = gitMod.isDirty as ReturnType<typeof vi.fn>
const mockValidateIssue = validationMod.validateIssueForStart as ReturnType<typeof vi.fn>
const mockValidateBranch = validationMod.validateBranchName as ReturnType<typeof vi.fn>
const mockMergeResults = validationMod.mergeResults as ReturnType<typeof vi.fn>
const mockWriteFileSync = fsMod.writeFileSync as ReturnType<typeof vi.fn>

function makeIssue(overrides = {}) {
  return {
    number: 42,
    title: 'feat(api): add listing search',
    body: '## Acceptance Criteria\n- [ ] GET /listings returns results',
    state: 'OPEN',
    labels: [{ name: 'status:ready' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchIssue.mockReturnValue(makeIssue())
  mockIsDirty.mockReturnValue(false)
  mockRun.mockReturnValue('')
  mockValidateIssue.mockReturnValue({ ok: true, errors: [], warnings: [] })
  mockValidateBranch.mockReturnValue({ ok: true, errors: [], warnings: [] })
  mockMergeResults.mockImplementation((...results: { ok: boolean; errors: string[]; warnings: string[] }[]) => ({
    ok: results.every((r) => r.ok),
    errors: results.flatMap((r) => r.errors),
    warnings: results.flatMap((r) => r.warnings),
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startCommand — issue validation failure', () => {
  it('throws CliError when issue validation fails', async () => {
    mockValidateIssue.mockReturnValue({
      ok: false,
      errors: ['Issue is already in-progress'],
      warnings: [],
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(startCommand(42)).rejects.toThrow('pre-flight checks failed')
  })
})

describe('startCommand — branch name validation failure', () => {
  it('throws CliError when branch name fails validation', async () => {
    mockValidateBranch.mockReturnValue({
      ok: false,
      errors: ['Branch must start with feat/'],
      warnings: [],
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(startCommand(42, { branch: 'bad-name' })).rejects.toThrow(
      'branch name does not conform',
    )
  })
})

describe('startCommand — dirty working tree', () => {
  it('throws CliError when working tree has uncommitted changes', async () => {
    mockIsDirty.mockReturnValue(true)
    await expect(startCommand(42)).rejects.toThrow('uncommitted changes')
  })
})

describe('startCommand — dry-run', () => {
  it('prints planned actions without executing side effects', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42, { dryRun: true })
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockEditIssueLabels).not.toHaveBeenCalled()
    expect(mockPostComment).not.toHaveBeenCalled()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('[dry-run]')
  })

  it('mentions context artifact write in dry-run output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42, { dryRun: true })
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('.agents/')
  })
})

describe('startCommand — happy path', () => {
  it('labels the issue, creates the branch, and posts a check-in comment', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42)

    expect(mockRun).toHaveBeenCalledWith('git fetch origin main')
    expect(mockRun).toHaveBeenCalledWith(expect.stringMatching(/git checkout -b .+ origin\/main/))
    expect(mockEditIssueLabels).toHaveBeenCalledWith(42, {
      add: ['status:in-progress'],
      remove: ['status:ready'],
    })
    expect(mockPostComment).toHaveBeenCalledWith(42, expect.stringContaining('Starting work on issue #42'))
  })

  it('writes context artifacts to the current directory after branch creation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42)

    // Artifacts must be written; look for issue-context.md
    expect(
      mockWriteFileSync.mock.calls.some(([path]) =>
        String(path).endsWith('.agents/issue-context.md'),
      ),
    ).toBe(true)
  })

  it('writes the same artifact schema version as run-sprint', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42)

    const issueContextWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith('.agents/issue-context.md'),
    )
    expect(String(issueContextWrite?.[1])).toContain('<!-- schema-version:')
  })

  it('uses the provided --branch override instead of deriving one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42, { branch: 'feat/issue-42-custom-slug' })

    const checkoutCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git checkout'),
    )
    expect(String(checkoutCall?.[0])).toContain('feat/issue-42-custom-slug')
  })

  it('sanitizes a user-provided branch — strips $ and parentheses before shell use', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42, { branch: 'feat/issue-42-evil$(echo pwned)' })

    const checkoutCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git checkout'),
    )
    const cmd = String(checkoutCall?.[0])
    // The dangerous $( sequence must be gone even if the plain words remain
    expect(cmd).not.toContain('$(')
  })

  it('emits warnings without failing when issue has warnings', async () => {
    mockValidateIssue.mockReturnValue({
      ok: true,
      errors: [],
      warnings: ['not labeled status:ready'],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42)
    expect(warn).toHaveBeenCalled()
    expect(mockEditIssueLabels).toHaveBeenCalled()
  })

  it('passes effort and model options through to the context artifacts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await startCommand(42, { effort: 'high', model: 'claude-opus-4-5' })

    expect(
      mockWriteFileSync.mock.calls.some(
        ([path, contents]) =>
          String(path).endsWith('.agents/worker-context.md') &&
          String(contents).includes('- Effort: high') &&
          String(contents).includes('- Model: claude-opus-4-5'),
      ),
    ).toBe(true)
  })
})
