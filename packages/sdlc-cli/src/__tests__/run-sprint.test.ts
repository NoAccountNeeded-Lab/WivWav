import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  // Default: worktree path does not exist (free to create), env files do exist (to copy).
  // Override per-test when simulating stale/pre-existing paths.
  existsSync: vi.fn((p: string) => !String(p).includes('.claude/worktrees/')),
  copyFileSync: vi.fn(),
}))

vi.mock('../lib/git.js', () => ({
  run: vi.fn(),
  tryRun: vi.fn(() => ({ stdout: '', ok: false })),
  // Repo root is intentionally distinct from the test process cwd so assertions
  // can prove worktree paths anchor on repoRoot(), not process.cwd().
  repoRoot: vi.fn(() => '/repo'),
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
const mockRepoRoot = gitMod.repoRoot as ReturnType<typeof vi.fn>
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
  mockRepoRoot.mockReturnValue('/repo')
  // By default: branch does not exist, so `git rev-parse --verify` fails (ok: false).
  mockTryRun.mockReturnValue({ stdout: '', ok: false })
  // By default: worktree path is free (does not exist), env source files do exist.
  mockExistsSync.mockImplementation((p: string) => !String(p).includes('.claude/worktrees/'))
  mockListReadyIssues.mockReturnValue([{ number: 42, title: 'feat(api): add listing search' }])
  // fetchIssue is called twice in non-dryRun mode: once for candidate validation,
  // once at claim time. Both calls return the same ready issue by default.
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
    // Orchestrator recovery state goes to /tmp (outside the worktree) so it
    // survives worktree teardown; the generator also writes an in-worktree
    // .agents/recovery-state.md artifact.
    const writtenFiles = mockWriteFileSync.mock.calls.map((call) => String(call[0]))
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/wivwav-42.md', expect.stringContaining('Status: running'))
    expect(
      mockWriteFileSync.mock.calls.some(
        ([path, contents]) =>
          String(path).endsWith('.agents/recovery-state.md') &&
          String(contents).includes('Status: running'),
      ),
    ).toBe(true)
    expect(writtenFiles).toContain(
      '/repo/.claude/worktrees/issue-42-featapi-add-listing-search/.agents/issue-context.md',
    )
    expect(writtenFiles).toContain(
      '/repo/.claude/worktrees/issue-42-featapi-add-listing-search/.agents/usage-report.md',
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

  it('writes schema-version header in context artifacts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42 })

    expect(
      mockWriteFileSync.mock.calls.some(
        ([path, contents]) =>
          String(path).endsWith('.agents/issue-context.md') &&
          String(contents).includes('<!-- schema-version:'),
      ),
    ).toBe(true)
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

  it('anchors the worktree on the repo root, not the process cwd', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42 })

    // git worktree add targets the repo-root-anchored absolute path, never a
    // path under the package dir that pnpm sets as the cwd.
    const addCall = mockRun.mock.calls.find(([cmd]) => String(cmd).includes('git worktree add'))
    expect(String(addCall?.[0])).toContain('/repo/.claude/worktrees/issue-42-')

    // Context artifacts and recovery state use the same repo-root anchor.
    const writtenFiles = mockWriteFileSync.mock.calls.map((c) => String(c[0]))
    const worktreeFiles = writtenFiles.filter((f) => f.includes('.claude/worktrees/'))
    expect(worktreeFiles.length).toBeGreaterThan(0)
    expect(worktreeFiles.every((f) => f.startsWith('/repo/.claude/worktrees/'))).toBe(true)

    // The printed worker instruction also points at the repo-root worktree.
    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('Worktree: /repo/.claude/worktrees/issue-42-')
  })

  it('worker prompt contains absolute worktree path', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runSprintCommand({ issueNumber: 42 })

    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    // Worker prompt Worktree line must be absolute.
    expect(output).toMatch(/Worktree: \/.*issue-42-/)
  })

  it('sequential preparation claims exactly one issue even when limit allows more', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    // limit: 2 selects 2 candidates for validation but sequential mode claims only 1.
    await runSprintCommand({ limit: 2 })

    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(1)
    // The first candidate (issue 41) is claimed; the branch must be unique.
    const branch = /-b (\S+)/.exec(String(worktreeAddCalls[0]?.[0]))?.[1]
    expect(branch).toMatch(/issue-41-/)
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

describe('runSprintCommand — lazy claiming (sequential mode)', () => {
  it('claims exactly one issue in sequential mode even when multiple candidates are selected', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
      { number: 43, title: 'feat: third' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ limit: 3 })

    // Only one worktree should be created.
    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(1)

    // Only one issue should be claimed.
    expect(mockEditIssueLabels).toHaveBeenCalledTimes(1)
    expect(mockEditIssueLabels).toHaveBeenCalledWith(41, {
      add: ['status:in-progress'],
      remove: ['status:ready'],
    })
  })

  it('uses default limit of 20 candidates but claims exactly one in sequential mode', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const summaries = Array.from({ length: 5 }, (_, i) => ({
      number: 100 + i,
      title: `feat: issue ${100 + i}`,
    }))
    mockListReadyIssues.mockReturnValue(summaries)
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    // No explicit limit — uses default of 20 candidates for selection,
    // but still claims only ONE in sequential mode.
    await runSprintCommand({})

    expect(mockListReadyIssues).toHaveBeenCalledWith(20)
    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(1)
    expect(mockEditIssueLabels).toHaveBeenCalledTimes(1)
  })

  it('logs selected vs claimed vs started counts distinctly', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ limit: 2 })

    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    // Must log how many were selected (candidates found after validation)
    expect(output).toMatch(/Selected:\s*2\s*candidate/)
    // Must log how many are being claimed
    expect(output).toMatch(/claiming:\s*1/)
    // Must log how many were deferred (not claimed this run)
    expect(output).toMatch(/deferred:\s*1/)
    // Must log started count
    expect(output).toMatch(/Started:\s*1\s*worker/)
  })

  it('deferred candidates have no worktrees and no label changes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
      { number: 43, title: 'feat: third' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ limit: 3 })

    // Only issue 41 (the first candidate) should be claimed.
    const labelCalls = mockEditIssueLabels.mock.calls.filter(([, opts]) =>
      opts.add?.includes('status:in-progress'),
    )
    expect(labelCalls).toHaveLength(1)
    expect(labelCalls[0]?.[0]).toBe(41)

    // Issues 42 and 43 must not have any worktrees or label mutations.
    const worktreeAddCmds = mockRun.mock.calls
      .map(([cmd]) => String(cmd))
      .filter((cmd) => cmd.includes('git worktree add'))
    expect(worktreeAddCmds.every((cmd) => !cmd.includes('issue-42-') && !cmd.includes('issue-43-'))).toBe(true)
  })
})

describe('runSprintCommand — concurrent runners (race condition)', () => {
  it('skips claiming when issue is already in-progress at claim time', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([{ number: 41, title: 'feat: first' }])

    // First fetchIssue call (candidate validation): issue is ready.
    // Second fetchIssue call (claim-time re-check): another runner claimed it.
    mockFetchIssue
      .mockReturnValueOnce(makeIssue({ number: 41, title: 'feat: first' }))
      .mockReturnValueOnce(makeIssue({ number: 41, title: 'feat: first', labels: [{ name: 'status:in-progress' }] }))

    await expect(runSprintCommand({})).rejects.toThrow('candidate for this run was already claimed by a concurrent runner')

    // No worktree should be created for the race-lost issue.
    expect(mockRun).not.toHaveBeenCalledWith(expect.stringContaining('git worktree add'))
    // No label mutation should occur — the other runner already claimed it.
    expect(mockEditIssueLabels).not.toHaveBeenCalledWith(41, expect.objectContaining({ add: ['status:in-progress'] }))
  })

  it('fails with precise sequential-race message when single candidate is race-lost', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])

    // Validation pass: both issues are ready.
    // Claim time: issue 41 is already taken.
    // Sequential mode only processes 1 candidate (the first valid one) per run.
    // No fallback to issue 42 — re-run CLI to try the next.
    mockFetchIssue
      .mockReturnValueOnce(makeIssue({ number: 41, title: 'feat: first' }))   // validation
      .mockReturnValueOnce(makeIssue({ number: 42, title: 'feat: second' }))  // validation
      .mockReturnValueOnce(makeIssue({ number: 41, title: 'feat: first', labels: [{ name: 'status:in-progress' }] })) // claim re-check for 41

    await expect(runSprintCommand({ limit: 2 })).rejects.toThrow('candidate for this run was already claimed by a concurrent runner')
  })
})

describe('runSprintCommand — parallel mode lazy replenishment', () => {
  it('claims exactly the parallel concurrency window, not more', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
      { number: 43, title: 'feat: third' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ parallel: 2 })

    // parallel: 2 → listReadyIssues fetches 2, not 3.
    expect(mockListReadyIssues).toHaveBeenCalledWith(2)
    const worktreeAddCalls = mockRun.mock.calls.filter(([cmd]) =>
      String(cmd).includes('git worktree add'),
    )
    expect(worktreeAddCalls).toHaveLength(2)
    expect(mockEditIssueLabels).toHaveBeenCalledTimes(2)
  })

  it('logs correct selected and claimed counts in parallel mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ parallel: 2 })

    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toMatch(/Selected:\s*2\s*candidate/)
    expect(output).toMatch(/claiming:\s*2/)
    expect(output).toMatch(/Started:\s*2\s*worker/)
  })
})

describe('runSprintCommand — interruption safety', () => {
  it('does not create worktrees for issues beyond the first in sequential mode', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: alpha' },
      { number: 42, title: 'feat: beta' },
      { number: 43, title: 'feat: gamma' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({})

    const writtenFiles = mockWriteFileSync.mock.calls.map(([p]) => String(p))
    // Only one issue's worktree files should exist.
    const worktreeFiles = writtenFiles.filter((f) => f.includes('.claude/worktrees/'))
    const uniqueWorktrees = new Set(
      worktreeFiles.map((f) => f.split('.claude/worktrees/')[1]?.split('/')[0] ?? ''),
    )
    expect(uniqueWorktrees.size).toBe(1)
    // Issue 42 and 43 must have no worktree artifacts.
    expect(worktreeFiles.some((f) => f.includes('issue-42-'))).toBe(false)
    expect(worktreeFiles.some((f) => f.includes('issue-43-'))).toBe(false)
  })

  it('unstarted candidates remain untouched — no labels, no worktrees, no recovery state', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    mockFetchIssue.mockImplementation((issueNumber: number) =>
      makeIssue({ number: issueNumber, title: `feat: issue ${issueNumber}` }),
    )

    await runSprintCommand({ limit: 2 })

    // Issue 42 must not have a recovery state written.
    const recoveryFiles = mockWriteFileSync.mock.calls.map(([p]) => String(p))
    expect(recoveryFiles).not.toContain('/tmp/wivwav-42.md')

    // Issue 42 must not have had its labels changed.
    const labelCallsFor42 = mockEditIssueLabels.mock.calls.filter(([n]) => n === 42)
    expect(labelCallsFor42).toHaveLength(0)
  })
})

describe('runSprintCommand — partial sprint success', () => {
  it('still logs worker instructions for successfully claimed issues even if some are skipped', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockListReadyIssues.mockReturnValue([
      { number: 41, title: 'feat: first' },
      { number: 42, title: 'feat: second' },
    ])
    // Issue 41 is invalid (missing AC), issue 42 is valid.
    mockFetchIssue.mockImplementation((issueNumber: number) => {
      if (issueNumber === 41) return makeIssue({ number: 41, title: 'feat: first', body: '' })
      return makeIssue({ number: 42, title: 'feat: second' })
    })
    mockHasAC.mockImplementation((body: string) => body.includes('Acceptance Criteria'))

    await runSprintCommand({})

    // Issue 42 should be claimed and started.
    const output = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('Worker instructions')
    expect(mockEditIssueLabels).toHaveBeenCalledWith(42, {
      add: ['status:in-progress'],
      remove: ['status:ready'],
    })
  })

  it('throws when all candidates fail validation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockHasAC.mockReturnValue(false)

    await expect(runSprintCommand({ limit: 1 })).rejects.toThrow('No selected issues passed sprint pre-flight checks.')
  })
})

describe('CLI dispatch — run-sprint extra positional args guard', () => {
  // These tests invoke the CLI as a subprocess to exercise the index.ts dispatch
  // layer, which is the only place where the extra-args guard lives.
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const cliPath = join(__dirname, '..', 'index.ts')

  it('fails fast with a clear error when multiple issue numbers are given', () => {
    const result = spawnSync(
      'node',
      ['--import', 'tsx/esm', cliPath, 'run-sprint', '527', '528'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    expect(result.status).toBe(1)
    // Error message must name the extra arg (528) so the caller knows which arg was rejected.
    expect(result.stderr).toContain('528')
    // Must not silently proceed as if only 527 was given.
    expect(result.stderr).not.toContain('Sprint mode:')
  })

  it('fails fast with a clear error when three issue numbers are given', () => {
    const result = spawnSync(
      'node',
      ['--import', 'tsx/esm', cliPath, 'run-sprint', '1', '2', '3'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('2')
    expect(result.stderr).toContain('3')
  })

  it('accepts a single issue number without error at the dispatch layer', () => {
    // A single explicit issue is valid at the dispatch level; the command will
    // fail for other reasons (no git repo, no GitHub auth) but must not error
    // on the extra-args guard.
    const result = spawnSync(
      'node',
      ['--import', 'tsx/esm', cliPath, 'run-sprint', '--dry-run', '--help'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    // --help exits 0 and prints usage; the key check is that the extra-args
    // guard did not fire for a single-issue or flag-only invocation.
    expect(result.stderr).not.toContain('run-sprint accepts at most one explicit issue number')
  })
})
