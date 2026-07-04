import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
}))

import {
  writeContextArtifacts,
  ARTIFACT_SCHEMA_VERSION,
  ARTIFACT_FILES,
  ContextError,
  type ContextInput,
} from '../lib/context.js'
import * as fsMod from 'node:fs'

const mockWriteFileSync = fsMod.writeFileSync as ReturnType<typeof vi.fn>
const mockReadFileSync = fsMod.readFileSync as ReturnType<typeof vi.fn>
const mockExistsSync = fsMod.existsSync as ReturnType<typeof vi.fn>

function makeInput(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    issue: {
      number: 99,
      title: 'feat(api): add wheelchair search',
      body: '## Acceptance Criteria\n- [ ] returns results',
      labels: ['status:ready'],
    },
    repo: { root: '/repo' },
    runtime: {
      worktreePath: '/repo/.claude/worktrees/issue-99-test',
      branch: 'feat/issue-99-add-wheelchair-search',
      sprintId: 'run-sprint/2026-06-27T10:12',
      effort: 'standard',
      model: 'sonnet',
      agentIndex: 1,
    },
    content: {
      acceptanceCriteria: ['- [ ] returns results'],
      likelyFiles: ['packages/api/src/routes/listings.ts'],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(false)
  mockReadFileSync.mockReturnValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

describe('ARTIFACT_SCHEMA_VERSION', () => {
  it('should be a non-empty string', () => {
    expect(typeof ARTIFACT_SCHEMA_VERSION).toBe('string')
    expect(ARTIFACT_SCHEMA_VERSION.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

describe('writeContextArtifacts — dry-run', () => {
  it('should not call writeFileSync in dry-run mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    writeContextArtifacts(makeInput(), { dryRun: true })

    expect(mockWriteFileSync).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('should log dry-run lines for each artifact', () => {
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(String(args[0]))
    })

    writeContextArtifacts(makeInput(), { dryRun: true })

    const joined = output.join('\n')
    expect(joined).toContain('[dry-run]')
    expect(joined).toContain('recovery-state.md')
  })
})

// ---------------------------------------------------------------------------
// Happy path — writes all artifact files
// ---------------------------------------------------------------------------

describe('writeContextArtifacts — happy path', () => {
  it('should write all expected artifact files', () => {
    writeContextArtifacts(makeInput())

    const written = mockWriteFileSync.mock.calls.map((c) => String(c[0]))
    const worktreePath = '/repo/.claude/worktrees/issue-99-test'

    for (const file of Object.values(ARTIFACT_FILES)) {
      expect(written.some((p) => p.endsWith(file.replace(/\//g, '/')))).toBe(true)
    }

    expect(written.some((p) => p.includes(worktreePath))).toBe(true)
  })

  it('should embed the schema version in each content artifact', () => {
    writeContextArtifacts(makeInput())

    const contentWrites = mockWriteFileSync.mock.calls
      .filter(([path]) => !String(path).endsWith('recovery-state.md'))
    for (const [, content] of contentWrites) {
      expect(String(content)).toContain(`schema-version: ${ARTIFACT_SCHEMA_VERSION}`)
    }
  })

  it('should include acceptance criteria in the issue-context artifact', () => {
    writeContextArtifacts(makeInput())

    const issueWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.issueContext),
    )
    expect(String(issueWrite?.[1])).toContain('returns results')
  })

  it('should include likely-file hints in the issue-context artifact', () => {
    writeContextArtifacts(makeInput())

    const issueWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.issueContext),
    )
    expect(String(issueWrite?.[1])).toContain('packages/api/src/routes/listings.ts')
  })

  it('should include effort and model in worker-context artifact', () => {
    writeContextArtifacts(makeInput())

    const workerWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.workerContext),
    )
    expect(String(workerWrite?.[1])).toContain('- Effort: standard')
    expect(String(workerWrite?.[1])).toContain('- Model: sonnet')
  })

  it('should write recovery-state as running then complete', () => {
    writeContextArtifacts(makeInput())

    const recoveryWrites = mockWriteFileSync.mock.calls.filter(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.recoveryState),
    )
    // First write: running; last write: complete
    expect(String(recoveryWrites[0]?.[1])).toContain('Status: running')
    expect(String(recoveryWrites[recoveryWrites.length - 1]?.[1])).toContain('Status: complete')
  })

  it('should produce identical schemas for start and run-sprint inputs with same issue data', () => {
    const input = makeInput()

    // Reset mocks to capture first call set
    mockWriteFileSync.mockClear()
    writeContextArtifacts(input)
    const callsA = mockWriteFileSync.mock.calls.map(([, content]) => String(content))

    // Run again with a different worktree path (simulating different command entry point)
    const input2 = makeInput({
      runtime: {
        ...input.runtime,
        worktreePath: '/repo/.claude/worktrees/issue-99-start',
        sprintId: 'start/2026-06-27T10:12',
      },
    })
    mockWriteFileSync.mockClear()
    mockExistsSync.mockReturnValue(false)
    writeContextArtifacts(input2)
    const callsB = mockWriteFileSync.mock.calls.map(([, content]) => String(content))

    // Content structure and headers are identical; only volatile fields differ
    expect(callsA.length).toBe(callsB.length)
    for (let i = 0; i < callsA.length; i++) {
      // Both have the same schema-version header
      const hasSchemaA = callsA[i]?.startsWith('<!-- schema-version:') || callsA[i]?.includes('Schema-Version:')
      const hasSchemaB = callsB[i]?.startsWith('<!-- schema-version:') || callsB[i]?.includes('Schema-Version:')
      expect(hasSchemaA).toBe(hasSchemaB)
    }
  })
})

// ---------------------------------------------------------------------------
// Idempotent / resume / force-replace behaviour
// ---------------------------------------------------------------------------

describe('writeContextArtifacts — idempotent mode', () => {
  it('should skip artifact files that already exist at the current schema version', () => {
    // Simulate existing files at current schema version
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(`<!-- schema-version: ${ARTIFACT_SCHEMA_VERSION} -->`)

    writeContextArtifacts(makeInput(), { idempotent: true })

    // Recovery state is always written; content artifacts are skipped
    const written = mockWriteFileSync.mock.calls.map(([path]) => String(path))
    const contentFiles = Object.values(ARTIFACT_FILES).filter(
      (f) => f !== ARTIFACT_FILES.recoveryState,
    )
    for (const file of contentFiles) {
      expect(written.some((p) => p.endsWith(file))).toBe(false)
    }
  })

  it('should rewrite artifact files when force-replace is set, even if schema matches', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(`<!-- schema-version: ${ARTIFACT_SCHEMA_VERSION} -->`)

    writeContextArtifacts(makeInput(), { forceReplace: true })

    const written = mockWriteFileSync.mock.calls.map(([path]) => String(path))
    expect(written.some((p) => p.endsWith(ARTIFACT_FILES.issueContext))).toBe(true)
  })

  it('should rewrite artifact files when idempotent is false', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(`<!-- schema-version: ${ARTIFACT_SCHEMA_VERSION} -->`)

    writeContextArtifacts(makeInput(), { idempotent: false })

    const written = mockWriteFileSync.mock.calls.map(([path]) => String(path))
    expect(written.some((p) => p.endsWith(ARTIFACT_FILES.issueContext))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Recovery state compatibility checks
// ---------------------------------------------------------------------------

describe('writeContextArtifacts — recovery state', () => {
  function recoveryContent(overrides: Record<string, string> = {}): string {
    const defaults = {
      'Schema-Version': ARTIFACT_SCHEMA_VERSION,
      'Issue': '#99',
      'Branch': 'feat/issue-99-add-wheelchair-search',
      'WorktreePath': '/repo/.claude/worktrees/issue-99-test',
      'SprintId': 'run-sprint/2026-06-27T10:12',
      'Status': 'running',
    }
    return Object.entries({ ...defaults, ...overrides })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') + '\n'
  }

  it('should refuse to overwrite a completed recovery state with a different branch', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      recoveryContent({ Branch: 'feat/issue-99-other-branch', Status: 'complete' }),
    )

    expect(() =>
      writeContextArtifacts(
        makeInput({
          runtime: {
            ...makeInput().runtime,
            branch: 'feat/issue-99-add-wheelchair-search',
          },
        }),
      ),
    ).toThrow(ContextError)
  })

  it('should refuse an in-progress recovery state with a different branch without --resume', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      recoveryContent({ Branch: 'feat/issue-99-old-branch', Status: 'running' }),
    )

    expect(() => writeContextArtifacts(makeInput())).toThrow(ContextError)
  })

  it('should allow an in-progress recovery state with a different branch when resume is set', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((path) => {
      if (String(path).endsWith('recovery-state.md')) {
        return recoveryContent({ Branch: 'feat/issue-99-old-branch', Status: 'running' })
      }
      return ''
    })

    expect(() => writeContextArtifacts(makeInput(), { resume: true })).not.toThrow()
  })

  it('should refuse when recovery state issue number does not match', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(recoveryContent({ Issue: '#55' }))

    expect(() => writeContextArtifacts(makeInput())).toThrow(ContextError)
  })

  it('should skip recovery-state check and overwrite when force-replace is set', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      recoveryContent({ Issue: '#999', Status: 'complete' }),
    )

    expect(() => writeContextArtifacts(makeInput(), { forceReplace: true })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('writeContextArtifacts — edge cases', () => {
  it('should use fallback text when acceptance criteria list is empty', () => {
    const input = makeInput({
      content: { acceptanceCriteria: [], likelyFiles: [] },
    })
    writeContextArtifacts(input)

    const issueWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.issueContext),
    )
    expect(String(issueWrite?.[1])).toContain('No structured acceptance criteria extracted')
  })

  it('should use fallback text when likely files list is empty', () => {
    const input = makeInput({
      content: { acceptanceCriteria: ['- [ ] works'], likelyFiles: [] },
    })
    writeContextArtifacts(input)

    const issueWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.issueContext),
    )
    expect(String(issueWrite?.[1])).toContain('No likely-file hints generated')
  })

  it('should handle issue with no body', () => {
    const input = makeInput({
      issue: { number: 1, title: 'chore: cleanup', body: '', labels: [] },
      content: { acceptanceCriteria: [], likelyFiles: [] },
    })
    writeContextArtifacts(input)

    const issueWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.issueContext),
    )
    expect(String(issueWrite?.[1])).toContain('_No issue body._')
  })

  it('should include issue number in finish-context closure instructions', () => {
    writeContextArtifacts(makeInput())

    const finishWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.finishContext),
    )
    expect(String(finishWrite?.[1])).toContain('pnpm wivwav finish 99')
    expect(String(finishWrite?.[1])).toContain('should remain open')
  })

  it('should include issue number in worker-context completion instructions', () => {
    writeContextArtifacts(makeInput())

    const workerWrite = mockWriteFileSync.mock.calls.find(([path]) =>
      String(path).endsWith(ARTIFACT_FILES.workerContext),
    )
    expect(String(workerWrite?.[1])).toContain('Completed issues must close on merge')
    expect(String(workerWrite?.[1])).toContain('without `--refs`')
  })
})
