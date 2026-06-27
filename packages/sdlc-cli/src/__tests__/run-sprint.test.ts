import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  // Default: worktree path does not exist (free to create), env files do exist (to copy).
  // Override per-test when simulating stale/pre-existing paths.
  existsSync: vi.fn((p: string) => !String(p).includes('.claude/worktrees/')),
  copyFileSync: vi.fn(),
}))

vi.mock('../lib/git.js', () => ({
  run: vi.fn(),
  tryRun: vi.fn(() => ({ stdout: '', ok: false })),
}))

vi.mock('../lib/github.js', () => ({
  fetchIssue: vi.fn(),
  listReadyIssues: vi.fn(),
  hasAcceptanceCriteria: vi.fn(() => true),
  extractAcceptanceCriteria: vi.fn(() => ['- [ ] works']),
  labelNames: vi.fn((issue: { labels: Array<{ name: string }> }) => issue.labels.map((l) => l.name)),
  editIssueLabels: vi.fn(),
  postComment: vi.fn(),
  CliError: class CliError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'CliError'
    }
  },
}))

import { runSprintCommand } from '../commands/run-sprint.js'
import * as fsMod from 'node:fs'
import * as gitMod from '../lib/git.js'
import * as githubMod from '../lib/github.js'

const mockMkdirSync = fsMod.mkdirSync as ReturnType<typeof vi.fn>
const mockWriteFileSync = fsMod.writeFileSync as ReturnType<typeof vi.fn>
const mockExistsSync = fsMod.existsSync as ReturnType<typeof vi.fn>
const mockRun = gitMod.run as ReturnType<typeof vi.fn>
const mockTryRun = gitMod.tryRun as ReturnType<typeof vi.fn>
const mockFetchIssue = githubMod.fetchIssue as ReturnType<typeof vi.fn>
const mockListReadyIssues = githubMod.listReadyIssues as ReturnType<typeof vi.fn>
const mockHasAC = githubMod.hasAcceptanceCriteria as ReturnType<typeof vi.fn>
const mockExtractAC = githubMod.extractAcceptanceCriteria as ReturnType<typeof vi.fn>
const mockEditIssueLabels = githubMod.editIssueLabels as ReturnType<typeof vi.fn>
const mockPostComment = githubMod.postComment as ReturnType<typeof vi.fn>

function makeIssue(overrides = {}) {
  return {
    number: 42,
    title: 'feat(api): add listing search',
    body: '## Acceptance Criteria\n- [ ] works',
    state: 'OPEN',
    labels: [{ name: 'status:ready' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRun.mockReturnValue('')
  // By default: branch does not exist, so `git rev-parse --verify` fails (ok: false).
  mockTryRun.mockReturnValue({ stdout: '', ok: false })
  // By default: worktree path is free (does not exist), env source files do exist.
  mockExistsSync.mockImplementation((p: string) => !String(p).includes('.claude/worktrees/'))
  mockListReadyIssues.mockReturnValue([{ number: 42, title: 'feat(api): add listing search' }])
  mockFetchIssue.mockReturnValue(makeIssue())
  mockHasAC.mockReturnValue(true)
  mockExtractAC.mockReturnValue(['- [ ] works'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runSprintCommand — dry-run', () => {
  it('prints planned worktree setup without mutating GitHub or git state', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42, dryRun: true })

    expect(mockFetchIssue).toHaveBeenCalledWith(42)
    expect(mockEditIssueLabels).not.toHaveBeenCalled()
    expect(mockPostComment).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockWriteFileSync).not.toHaveBeenCalled()
    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('[dry-run]')
    expect(output).toContain('[dry-run] write')
  })
})

describe('runSprintCommand — issue selection', () => {
  it('claims listed ready issues and creates worker worktrees', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ limit: 1 })

    expect(mockListReadyIssues).toHaveBeenCalledWith(1)
    expect(mockRun).toHaveBeenCalledWith('git worktree prune')
    expect(mockRun).toHaveBeenCalledWith('git fetch origin main')
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('git worktree add -b feat/issue-42-'))
    expect(mockEditIssueLabels).toHaveBeenCalledWith(42, {
      add: ['status:in-progress'],
      remove: ['status:ready'],
    })
    expect(mockPostComment).toHaveBeenCalledWith(42, expect.stringContaining('Sprint worker starting'))
    expect(mockMkdirSync).toHaveBeenCalled()
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/wivwav-42.md', expect.stringContaining('Status: running'))
    const writtenFiles = mockWriteFileSync.mock.calls.map((call) => String(call[0]))
    expect(writtenFiles).toContain(
      '.claude/worktrees/issue-42-featapi-add-listing-search/.agents/issue-context.md',
    )
    expect(writtenFiles).toContain(
      '.claude/worktrees/issue-42-featapi-add-listing-search/.agents/usage-report.md',
    )
    expect(
      mockWriteFileSync.mock.calls.some(
        ([, contents]) =>
          String(contents).includes('## Acceptance Criteria') &&
          String(contents).includes('- [ ] works'),
      ),
    ).toBe(true)
    expect(
      mockWriteFileSync.mock.calls.some(
        ([, contents]) =>
          String(contents).includes('| Phase | Agent role/index | Provider | Model | Input tokens |'),
      ),
    ).toBe(true)
    expect(
      mockWriteFileSync.mock.calls.some(
        ([path, contents]) =>
          String(path).endsWith('.agents/worker-context.md') &&
          String(contents).includes('Completed issues must close on merge') &&
          String(contents).includes('without `--refs`'),
      ),
    ).toBe(true)
    expect(
      mockWriteFileSync.mock.calls.some(
        ([path, contents]) =>
          String(path).endsWith('.agents/finish-context.md') &&
          String(contents).includes('The default uses GitHub closing keywords') &&
          String(contents).includes('should remain open'),
      ),
    ).toBe(true)
    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('Worker instructions')
    expect(output).toContain('read `.agents/worker-context.md`')
    expect(output).toContain('Track model and token usage')
  })

  it('writes provider-neutral effort and model guidance', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42, effort: 'high', model: 'provider/model-v1' })

    expect(
      mockWriteFileSync.mock.calls.some(
        ([, contents]) =>
          String(contents).includes('- Effort guidance: high') &&
          String(contents).includes('- Model guidance: provider/model-v1'),
      ),
    ).toBe(true)
  })

  it('writes non-authoritative likely-file hints from deterministic git filenames', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockRun.mockImplementation((command: string) =>
      command === 'git ls-files'
        ? [
          'packages/sdlc-cli/src/commands/run-sprint.ts',
          'packages/sdlc-cli/src/__tests__/run-sprint.test.ts',
          'apps/web/src/app/page.tsx',
        ].join('\n')
        : '',
    )
    mockFetchIssue.mockReturnValue(
      makeIssue({
        title: 'Optimize run sprint context',
        body: '## Acceptance Criteria\n- [ ] run-sprint writes context',
      }),
    )

    await runSprintCommand({ issueNumber: 42 })

    expect(
      mockWriteFileSync.mock.calls.some(
        ([, contents]) =>
          String(contents).includes('These hints come from deterministic filename matching') &&
          String(contents).includes('packages/sdlc-cli/src/commands/run-sprint.ts'),
      ),
    ).toBe(true)
  })

  it('assigns unique agent indexes in parallel mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ parallel: 2, dryRun: true })

    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(mockListReadyIssues).toHaveBeenCalledWith(2)
    expect(output).toContain('Agent-Index: 1')
    expect(output).toContain('Agent-Index: 2')
  })
})

describe('runSprintCommand — pre-flight', () => {
  it('marks missing-AC issues stuck and does not create a worktree', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockHasAC.mockReturnValue(false)

    await expect(runSprintCommand({ limit: 1 })).rejects.toThrow('No selected issues passed')

    expect(mockEditIssueLabels).toHaveBeenCalledWith(42, {
      add: ['status:stuck'],
      remove: ['status:ready'],
    })
    expect(mockRun).not.toHaveBeenCalledWith(expect.stringContaining('git worktree add'))
  })

  it('allows an explicit issue that is open but not labeled ready', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockFetchIssue.mockReturnValue(makeIssue({ labels: [] }))

    await runSprintCommand({ issueNumber: 42, dryRun: true })

    expect(mockFetchIssue).toHaveBeenCalledWith(42)
  })
})

describe('runSprintCommand — single owner enforcement', () => {
  it('throws when the worktree path already exists (stale/interrupted preparation)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // Simulate a stale worktree: existsSync returns true for any path.
    mockExistsSync.mockReturnValue(true)

    await expect(runSprintCommand({ issueNumber: 42 })).rejects.toThrow(
      'Worktree path already exists',
    )
    expect(mockRun).not.toHaveBeenCalledWith(expect.stringContaining('git worktree add'))
  })

  it('throws when the branch already exists (pre-existing preparation)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // Worktree path is free; branch already exists.
    mockExistsSync.mockImplementation((p: string) => !String(p).includes('.claude/worktrees/'))
    mockTryRun.mockReturnValue({ stdout: 'abc1234', ok: true })

    await expect(runSprintCommand({ issueNumber: 42 })).rejects.toThrow(
      'Branch already exists',
    )
    expect(mockRun).not.toHaveBeenCalledWith(expect.stringContaining('git worktree add'))
  })

  it('recovery state names CLI as owner with absolute worktree path', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42 })

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/wivwav-42.md',
      expect.stringContaining('Owner: CLI'),
    )
    // Recovery state uses absolute path (contains the cwd prefix).
    const recoveryCall = mockWriteFileSync.mock.calls.find(([p]) => p === '/tmp/wivwav-42.md')
    expect(recoveryCall).toBeDefined()
    const recoveryContent = String(recoveryCall?.[1] ?? '')
    // Absolute path starts with '/' and contains the relative worktree slug.
    expect(recoveryContent).toMatch(/Worktree: \/.*issue-42-/)
  })

  it('worker prompt contains absolute worktree path', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42 })

    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    // Worker prompt Worktree line must be absolute.
    expect(output).toMatch(/Worktree: \/.*issue-42-/)
  })

  it('sequential preparation creates exactly one branch and one worktree per issue', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ limit: 2 })

    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(2)
    // Each call uses a unique branch and path.
    const branches = worktreeAddCalls.map(([cmd]) => {
      const match = /-b (\S+)/.exec(String(cmd))
      return match?.[1]
    })
    expect(new Set(branches).size).toBe(2)
  })

  it('parallel preparation creates exactly one branch and one worktree per issue', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 43, title: 'feat: alpha' },
      { number: 44, title: 'feat: beta' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ parallel: 2 })

    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(2)
    const branches = worktreeAddCalls.map(([cmd]) => {
      const match = /-b (\S+)/.exec(String(cmd))
      return match?.[1]
    })
    expect(new Set(branches).size).toBe(2)
  })
})
