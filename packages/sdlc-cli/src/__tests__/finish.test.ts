import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { deriveScope, titleToDescription } from '../commands/finish.js'

describe('deriveScope', () => {
  it('returns api for api route files', () => {
    expect(deriveScope(['apps/api/src/routes/listings.ts'])).toBe('api')
  })

  it('returns web for web app files', () => {
    expect(deriveScope(['apps/web/src/app/page.tsx'])).toBe('web')
  })

  it('picks the most frequently changed scope', () => {
    const files = [
      'apps/api/src/routes/listings.ts',
      'apps/api/src/plugins/auth.ts',
      'apps/web/src/app/page.tsx',
    ]
    expect(deriveScope(files)).toBe('api')
  })

  it('returns sdlc for .claude files', () => {
    expect(deriveScope(['.claude/skills/wivwav-finish.md'])).toBe('sdlc')
  })

  it('returns misc when no prefix matches', () => {
    expect(deriveScope(['random/unknown/path.ts'])).toBe('misc')
  })

  it('returns sdlc for an empty list', () => {
    expect(deriveScope([])).toBe('sdlc')
  })
})

describe('titleToDescription', () => {
  it('strips conventional-commit prefix and lowercases first char', () => {
    expect(titleToDescription('feat(api): Add listing search endpoint')).toBe(
      'add listing search endpoint',
    )
  })

  it('strips plain prefix without scope', () => {
    expect(titleToDescription('fix: Correct pagination offset')).toBe(
      'correct pagination offset',
    )
  })

  it('passes through plain titles unchanged (except case)', () => {
    expect(titleToDescription('Add wheelchair listing page')).toBe(
      'add wheelchair listing page',
    )
  })
})

// ---------------------------------------------------------------------------
// finishCommand behavioural tests — external boundaries are mocked
// ---------------------------------------------------------------------------
vi.mock('../lib/git.js', () => ({
  currentBranch: vi.fn(() => 'feat/issue-304-add-sdlc-cli'),
  isProtectedBranch: vi.fn(() => false),
  isBehindOriginMain: vi.fn(() => false),
  commitsAheadOfMain: vi.fn(() => 0),
  stagedFiles: vi.fn(() => []),
  dirtyFiles: vi.fn(() => []),
  changedFiles: vi.fn(() => ['packages/sdlc-cli/src/index.ts']),
  tryRun: vi.fn(() => ({ stdout: '', ok: true })),
  run: vi.fn(),
  expectedPrefix: vi.fn(() => 'feat'),
}))

vi.mock('../lib/github.js', () => ({
  fetchIssue: vi.fn(),
  hasAcceptanceCriteria: vi.fn(() => true),
  labelNames: vi.fn(() => ['status:in-progress']),
  createDraftPr: vi.fn(() => 'https://github.com/org/repo/pull/123'),
  findExistingPr: vi.fn(() => null),
  updatePrBody: vi.fn(),
  editIssueLabels: vi.fn(),
  CliError: class CliError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'CliError'
    }
  },
}))

import { finishCommand } from '../commands/finish.js'
import * as gitMod from '../lib/git.js'
import * as githubMod from '../lib/github.js'

const mockCurrentBranch = gitMod.currentBranch as ReturnType<typeof vi.fn>
const mockIsProtected = gitMod.isProtectedBranch as ReturnType<typeof vi.fn>
const mockIsBehind = gitMod.isBehindOriginMain as ReturnType<typeof vi.fn>
const mockCommitsAheadOfMain = gitMod.commitsAheadOfMain as ReturnType<typeof vi.fn>
const mockStagedFiles = gitMod.stagedFiles as ReturnType<typeof vi.fn>
const mockDirtyFiles = gitMod.dirtyFiles as ReturnType<typeof vi.fn>
const mockChangedFiles = gitMod.changedFiles as ReturnType<typeof vi.fn>
const mockTryRun = gitMod.tryRun as ReturnType<typeof vi.fn>
const mockRun = gitMod.run as ReturnType<typeof vi.fn>
const mockExpectedPrefix = gitMod.expectedPrefix as ReturnType<typeof vi.fn>
const mockFetchIssue = githubMod.fetchIssue as ReturnType<typeof vi.fn>
const mockHasAC = githubMod.hasAcceptanceCriteria as ReturnType<typeof vi.fn>
const mockLabelNames = githubMod.labelNames as ReturnType<typeof vi.fn>
const mockCreateDraftPr = githubMod.createDraftPr as ReturnType<typeof vi.fn>
const mockEditIssueLabels = githubMod.editIssueLabels as ReturnType<typeof vi.fn>

function makeIssue(overrides = {}) {
  return {
    number: 304,
    title: 'feat(sdlc): add SDLC CLI',
    body: '## Acceptance Criteria\n- [ ] start command works\n- [ ] finish command works',
    state: 'OPEN',
    labels: [{ name: 'status:in-progress' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentBranch.mockReturnValue('feat/issue-304-add-sdlc-cli')
  mockIsProtected.mockReturnValue(false)
  mockIsBehind.mockReturnValue(false)
  mockCommitsAheadOfMain.mockReturnValue(0)
  mockStagedFiles.mockReturnValue(['packages/sdlc-cli/src/index.ts'])
  mockDirtyFiles.mockReturnValue(['packages/sdlc-cli/src/index.ts'])
  mockChangedFiles.mockReturnValue(['packages/sdlc-cli/src/index.ts'])
  mockTryRun.mockReturnValue({ stdout: 'all good', ok: true })
  mockRun.mockReturnValue('')
  mockExpectedPrefix.mockReturnValue('feat')
  mockFetchIssue.mockReturnValue(makeIssue())
  mockHasAC.mockReturnValue(true)
  mockLabelNames.mockReturnValue(['status:in-progress'])
  mockCreateDraftPr.mockReturnValue('https://github.com/org/repo/pull/123')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('finishCommand — protected branch guard', () => {
  it('throws CliError when run from a protected branch', async () => {
    mockIsProtected.mockReturnValue(true)
    await expect(finishCommand(304, { skipValidation: true })).rejects.toThrow('feature branch')
  })
})

describe('finishCommand — issue pre-flight', () => {
  it('throws when issue is not labeled status:in-progress', async () => {
    mockLabelNames.mockReturnValue(['status:ready'])
    await expect(finishCommand(304, { skipValidation: true })).rejects.toThrow('not labeled status:in-progress')
  })

  it('throws when issue has no acceptance criteria', async () => {
    mockHasAC.mockReturnValue(false)
    await expect(finishCommand(304, { skipValidation: true })).rejects.toThrow('no acceptance criteria')
  })
})

describe('finishCommand — pre-finish rebase', () => {
  it('fetches origin/main before running validation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304)
    const tryCalls = (mockTryRun.mock.calls as unknown[][]).map((c) => String(c[0]))
    expect(tryCalls.some((c) => c === 'git fetch origin main')).toBe(true)
  })

  it('rebases when branch is behind origin/main', async () => {
    mockIsBehind.mockReturnValue(true)
    mockTryRun.mockReturnValue({ stdout: '', ok: true })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304)
    const tryCalls = (mockTryRun.mock.calls as unknown[][]).map((c) => String(c[0]))
    expect(tryCalls.some((c) => c === 'git rebase origin/main')).toBe(true)
  })

  it('throws when rebase fails', async () => {
    mockIsBehind.mockReturnValue(true)
    mockTryRun.mockImplementation((cmd: string) => {
      if (cmd === 'git rebase origin/main') return { stdout: 'CONFLICT', ok: false }
      return { stdout: '', ok: true }
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(finishCommand(304)).rejects.toThrow('rebase against origin/main failed')
  })

  it('skips rebase when branch is up-to-date', async () => {
    mockIsBehind.mockReturnValue(false)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304)
    const tryCalls = (mockTryRun.mock.calls as unknown[][]).map((c) => String(c[0]))
    expect(tryCalls.some((c) => c === 'git rebase origin/main')).toBe(false)
  })

  it('skips fetch and rebase when skipValidation is true', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })
    const tryCalls = (mockTryRun.mock.calls as unknown[][]).map((c) => String(c[0]))
    expect(tryCalls.some((c) => c === 'git fetch origin main')).toBe(false)
    expect(tryCalls.some((c) => c === 'git rebase origin/main')).toBe(false)
  })
})

describe('finishCommand — validation', () => {
  it('throws when full validation suite fails', async () => {
    mockTryRun.mockReturnValue({ stdout: 'type error', ok: false })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(finishCommand(304)).rejects.toThrow('validation suite did not pass')
  })

  it('skips validation when skipValidation is true', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })
    const tryRunCalls = mockTryRun.mock.calls as unknown[][]
    const ranValidation = tryRunCalls.some((c) => String(c[0]).includes('pnpm typecheck'))
    expect(ranValidation).toBe(false)
  })

  it('runs build as part of the full validation suite', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304)
    expect(mockTryRun).toHaveBeenCalledWith('pnpm typecheck && pnpm lint && pnpm build && pnpm test')
  })
})

describe('finishCommand — staging checks', () => {
  it('throws when no files are staged and no commits ahead of main', async () => {
    mockStagedFiles.mockReturnValue([])
    mockCommitsAheadOfMain.mockReturnValue(0)
    await expect(finishCommand(304, { skipValidation: true })).rejects.toThrow('Nothing to finish')
  })

  it('throws when there are unstaged dirty files', async () => {
    mockStagedFiles.mockReturnValue(['packages/sdlc-cli/src/index.ts'])
    mockDirtyFiles.mockReturnValue([
      'packages/sdlc-cli/src/index.ts',
      'some/unrelated/file.ts',
    ])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(finishCommand(304, { skipValidation: true })).rejects.toThrow(
      'stage only files relevant',
    )
  })

  it('proceeds when all dirty files are staged', async () => {
    const files = ['packages/sdlc-cli/src/index.ts']
    mockStagedFiles.mockReturnValue(files)
    mockDirtyFiles.mockReturnValue(files)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('git commit'))
  })
})

describe('finishCommand — commit type derivation', () => {
  it('uses expectedPrefix from issue title when no commitType is provided', async () => {
    mockExpectedPrefix.mockReturnValue('fix')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })
    const commitCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git commit'),
    )
    expect(String(commitCall?.[0])).toContain('fix(')
  })

  it('uses explicit commitType when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true, commitType: 'chore' })
    const commitCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git commit'),
    )
    expect(String(commitCall?.[0])).toContain('chore(')
  })
})

describe('finishCommand — dry-run', () => {
  it('prints planned actions without calling run', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true, dryRun: true })
    expect(mockRun).not.toHaveBeenCalled()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('[dry-run]')
    expect(allOutput).toContain('git commit')
    expect(allOutput).toContain('git push')
  })
})

describe('finishCommand — happy path', () => {
  it('calls git commit, git push, and createDraftPr in order', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })

    const calls = (mockRun.mock.calls as unknown[][]).map((c) => String(c[0]))
    const commitIdx = calls.findIndex((c) => c.includes('git commit'))
    const pushIdx = calls.findIndex((c) => c.includes('git push'))
    expect(commitIdx).toBeGreaterThanOrEqual(0)
    expect(pushIdx).toBeGreaterThan(commitIdx)
    expect(mockCreateDraftPr).toHaveBeenCalledOnce()
  })

  it('moves the issue to status:needs-review after opening the draft PR', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })

    expect(mockEditIssueLabels).toHaveBeenCalledWith(304, {
      add: ['status:needs-review'],
      remove: ['status:in-progress'],
    })
  })

  it('includes Co-Authored-By trailer in commit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true, coAuthoredBy: 'Test Bot <bot@example.com>' })
    const commitCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git commit'),
    )
    expect(String(commitCall?.[0])).toContain('Co-Authored-By: Test Bot <bot@example.com>')
  })

  it('adds a closing keyword to the draft PR body by default', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })

    // No agentRole provided — no attribution header; Fixes #N must still be first line.
    expect(mockCreateDraftPr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/^Fixes #304\n\n## Summary/),
      }),
    )
  })

  it('includes attribution header when agentRole is provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true, agentRole: 'worker', agentIndex: 1 })

    expect(mockCreateDraftPr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(
          /^Fixes #304\n🤖 \*\*worker\[1\]\*\* · `wivwav-finish` · \d{4}-\d{2}-\d{2}/,
        ),
      }),
    )
  })

  it('notes skipped validation in the Tests section', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true })

    expect(mockCreateDraftPr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Validation skipped'),
      }),
    )
  })

  it('uses non-closing references only when refs mode is requested', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await finishCommand(304, { skipValidation: true, fixes: false })

    const commitCall = (mockRun.mock.calls as unknown[][]).find((c) =>
      String(c[0]).includes('git commit'),
    )
    expect(String(commitCall?.[0])).toContain('refs #304')
    expect(mockCreateDraftPr).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Refs #304'),
      }),
    )
  })
})
