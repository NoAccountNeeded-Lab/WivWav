/**
 * Tests for the review command.
 *
 * reviewCommand has two external service boundaries:
 *   - ../lib/git.js  (git CLI calls)
 *   - ../lib/github.js (gh CLI / network calls)
 *
 * Both are mocked here. Internal helpers (extractAcItems, buildDomainNotes)
 * are private; they are exercised indirectly through reviewCommand.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — declared before any import of the module under test so that
// Vitest's hoisting can replace the modules before reviewCommand is loaded.
// ---------------------------------------------------------------------------
vi.mock('../lib/git.js', () => ({
  currentBranch: vi.fn(() => 'feat/issue-304-add-sdlc-cli'),
  isProtectedBranch: vi.fn(() => false),
  changedFiles: vi.fn(() => []),
  tryRun: vi.fn(() => ({ stdout: '', ok: true })),
}))

vi.mock('../lib/github.js', () => ({
  fetchIssue: vi.fn(),
  hasAcceptanceCriteria: vi.fn(() => false),
  CliError: class CliError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'CliError'
    }
  },
}))

import { reviewCommand } from '../commands/review.js'
import * as gitMod from '../lib/git.js'
import * as githubMod from '../lib/github.js'

// Typed helpers to satisfy TypeScript narrowing on mocked functions
const mockCurrentBranch = gitMod.currentBranch as ReturnType<typeof vi.fn>
const mockIsProtected = gitMod.isProtectedBranch as ReturnType<typeof vi.fn>
const mockChangedFiles = gitMod.changedFiles as ReturnType<typeof vi.fn>
const mockTryRun = gitMod.tryRun as ReturnType<typeof vi.fn>
const mockFetchIssue = githubMod.fetchIssue as ReturnType<typeof vi.fn>
const mockHasAC = githubMod.hasAcceptanceCriteria as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to safe defaults
  mockCurrentBranch.mockReturnValue('feat/issue-304-test')
  mockIsProtected.mockReturnValue(false)
  mockChangedFiles.mockReturnValue([])
  mockTryRun.mockReturnValue({ stdout: 'all good', ok: true })
  mockFetchIssue.mockReturnValue({
    number: 1,
    title: 'feat: test',
    body: '',
    state: 'OPEN',
    labels: [],
  })
  mockHasAC.mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Guard: protected branch
// ---------------------------------------------------------------------------
describe('reviewCommand — protected branch guard', () => {
  it('throws CliError when run from a protected branch', async () => {
    mockIsProtected.mockReturnValue(true)
    await expect(reviewCommand()).rejects.toThrow('feature branch')
  })
})

// ---------------------------------------------------------------------------
// No changed files
// ---------------------------------------------------------------------------
describe('reviewCommand — no changed files', () => {
  it('logs "Nothing to review" and returns without throwing', async () => {
    mockChangedFiles.mockReturnValue([])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(reviewCommand()).resolves.toBeUndefined()
    expect(log.mock.calls.some((c) => String(c[0]).includes('Nothing to review'))).toBe(true)
    log.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Affected-only vs full validation
// ---------------------------------------------------------------------------
describe('reviewCommand — validation mode', () => {
  beforeEach(() => {
    mockChangedFiles.mockReturnValue(['apps/api/src/routes/listings.ts'])
  })

  it('runs pnpm check:affected by default (affected mode)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const callArgs = mockTryRun.mock.calls.map((c: unknown[]) => c[0])
    expect(callArgs.some((a: unknown) => String(a).includes('check:affected'))).toBe(true)
  })

  it('runs the full suite when opts.full is true', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand({ full: true })
    const callArgs = mockTryRun.mock.calls.map((c: unknown[]) => c[0])
    expect(callArgs.some((a: unknown) => String(a).includes('pnpm typecheck'))).toBe(true)
  })

  it('throws CliError when validation fails', async () => {
    mockTryRun.mockReturnValue({ stdout: 'type error somewhere', ok: false })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(reviewCommand()).rejects.toThrow('validation suite did not pass')
  })
})

// ---------------------------------------------------------------------------
// Domain notes — buildDomainNotes (exercised indirectly via console output)
// ---------------------------------------------------------------------------
describe('reviewCommand — domain notes', () => {
  it('emits WCAG note for apps/web changes', async () => {
    mockChangedFiles.mockReturnValue(['apps/web/src/components/ListingCard.tsx'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toMatch(/WCAG|keyboard navigation|ARIA/)
    log.mockRestore()
  })

  it('emits AGENTS.md route-table note for apps/api/src/routes changes', async () => {
    mockChangedFiles.mockReturnValue(['apps/api/src/routes/listings.ts'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toMatch(/AGENTS\.md/)
    log.mockRestore()
  })

  it('emits scraper arrow-function warning for apps/scraper changes', async () => {
    mockChangedFiles.mockReturnValue(['apps/scraper/src/engine.ts'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toMatch(/arrow function|page\.evaluate/)
    log.mockRestore()
  })

  it('emits secrets warning when a .env file is in the diff', async () => {
    mockChangedFiles.mockReturnValue(['.env.local'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toMatch(/secrets|\.env/)
    log.mockRestore()
  })

  it('does not emit a Domain Notes section for unrelated file paths', async () => {
    mockChangedFiles.mockReturnValue(['packages/types/src/listing.ts'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    // The "## Domain Notes" heading must not appear when no domain rule fires
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).not.toContain('## Domain Notes')
    log.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// AC extraction (exercised via issueNumber option)
// ---------------------------------------------------------------------------
describe('reviewCommand — acceptance criteria extraction', () => {
  beforeEach(() => {
    mockChangedFiles.mockReturnValue(['packages/types/src/listing.ts'])
  })

  it('prints AC checklist items when issue has checkbox-style criteria', async () => {
    mockHasAC.mockReturnValue(true)
    mockFetchIssue.mockReturnValue({
      number: 42,
      title: 'feat: add listing',
      body: '## Acceptance Criteria\n- [ ] GET /listings returns 200\n- [x] supports query param',
      state: 'OPEN',
      labels: [],
    })

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand({ issueNumber: 42 })
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('GET /listings returns 200')
    expect(allOutput).toContain('supports query param')
    log.mockRestore()
  })

  it('warns when issue has no acceptance criteria', async () => {
    mockHasAC.mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand({ issueNumber: 99 })
    const warnOutput = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warnOutput).toMatch(/no acceptance criteria/)
    warn.mockRestore()
  })

  it('fails closed when fetchIssue throws', async () => {
    mockFetchIssue.mockImplementation(() => {
      throw new Error('network error')
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await expect(reviewCommand({ issueNumber: 99 })).rejects.toThrow(/Could not fetch issue #99/)
  })

  it('extracts items from "Done when" bullet list when no checkboxes exist', async () => {
    mockHasAC.mockReturnValue(true)
    mockFetchIssue.mockReturnValue({
      number: 55,
      title: 'feat: new thing',
      body: '## Done when\n- users can search by zip\n- results are paginated',
      state: 'OPEN',
      labels: [],
    })

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand({ issueNumber: 55 })
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('users can search by zip')
    log.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Review packet — always printed
// ---------------------------------------------------------------------------
describe('reviewCommand — review packet output', () => {
  it('always prints the four standard review dimensions', async () => {
    mockChangedFiles.mockReturnValue(['packages/db/src/client.ts'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('Type safety')
    expect(allOutput).toContain('Security')
    expect(allOutput).toContain('Logic bugs')
    expect(allOutput).toContain('Acceptance criteria')
    log.mockRestore()
  })

  it('prints the branch name in the review packet header', async () => {
    mockCurrentBranch.mockReturnValue('feat/issue-304-test-branch')
    mockChangedFiles.mockReturnValue(['packages/db/src/client.ts'])
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await reviewCommand()
    const allOutput = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allOutput).toContain('feat/issue-304-test-branch')
    log.mockRestore()
  })
})
