import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}))

vi.mock('../lib/git.js', () => ({
  run: vi.fn(),
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
const mockRun = gitMod.run as ReturnType<typeof vi.fn>
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
