/**
 * Shared context-artifact generator for `wivwav start` and `wivwav run-sprint`.
 *
 * Both commands call `writeContextArtifacts` with a `ContextInput` value.
 * The resulting `.agents/` files are semantically identical for identical inputs;
 * only explicitly volatile fields (worktreePath, sprintId) differ between commands.
 *
 * Schema version is embedded in every artifact header so downstream consumers
 * (e.g. #465) can detect incompatible artifacts and trigger migrations.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Artifact schema version — increment when the artifact shape changes in a breaking way. */
export const ARTIFACT_SCHEMA_VERSION = '2'

/** Sentinel written into recovery state when preparation is running. */
const RECOVERY_STATUS_RUNNING = 'running'

/** Sentinel written into recovery state when preparation completed successfully. */
const RECOVERY_STATUS_COMPLETE = 'complete'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Issue metadata required to generate context artifacts. */
export interface ContextIssue {
  number: number
  title: string
  body: string
  /** Label name strings derived from the issue's label objects. */
  labels: string[]
}

/** Repository/base metadata used in artifact headers. */
export interface ContextRepo {
  /** Root directory of the repository checkout (typically process.cwd()). */
  root: string
}

/** Runtime capabilities provided by the calling command. */
export interface ContextRuntime {
  /** Absolute or repo-relative path where the worktree lives. */
  worktreePath: string
  /** Expected branch name for this issue. */
  branch: string
  /** Sprint run identifier, e.g. `run-sprint/2026-06-27T10:12`. */
  sprintId: string
  /** Recommended effort level for the worker. */
  effort: 'low' | 'standard' | 'high'
  /** Recommended model hint for the worker (provider-neutral). */
  model: string
  /** 1-based index used for parallel sprint workers. */
  agentIndex: number
}

/** Pre-computed content hints derived outside the generator. */
export interface ContextContent {
  /** Structured acceptance criteria lines extracted from the issue body. */
  acceptanceCriteria: string[]
  /** Non-authoritative filename hints produced by deterministic matching. */
  likelyFiles: string[]
}

/**
 * Complete input for the context generator.
 * Pass all fields; the generator determines what to write.
 */
export interface ContextInput {
  issue: ContextIssue
  repo: ContextRepo
  runtime: ContextRuntime
  content: ContextContent
}

// ---------------------------------------------------------------------------
// Generation options
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Print planned writes without touching the filesystem or GitHub. */
  dryRun?: boolean
  /**
   * Idempotent rerun (default true): skip files that already exist and whose
   * schema version matches.  Pass `false` to force a fresh write unconditionally.
   */
  idempotent?: boolean
  /**
   * Resume mode: treat an in-progress recovery state as valid and continue.
   * Fails closed when a `complete` recovery state with a different branch is found.
   */
  resume?: boolean
  /**
   * Force-replace: overwrite all existing artifacts, ignoring recovery state.
   * Takes precedence over `idempotent` and `resume`.
   */
  forceReplace?: boolean
}

// ---------------------------------------------------------------------------
// Recovery state
// ---------------------------------------------------------------------------

/** Parsed recovery state file. */
interface RecoveryState {
  issue: number
  branch: string
  worktreePath: string
  sprintId: string
  status: string
}

function parseRecoveryState(text: string): RecoveryState | null {
  const fields: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\w[\w-]*):\s*(.+)$/.exec(line.trim())
    if (m?.[1] !== undefined && m[2] !== undefined) {
      fields[m[1].toLowerCase()] = m[2].trim()
    }
  }
  if (!fields['issue'] || !fields['branch'] || !fields['worktreepath'] || !fields['status']) {
    return null
  }
  return {
    issue: parseInt(fields['issue']?.replace(/^#/, '') ?? '0', 10),
    branch: fields['branch'] ?? '',
    worktreePath: fields['worktreepath'] ?? '',
    sprintId: fields['sprintid'] ?? '',
    status: fields['status'] ?? '',
  }
}

function formatRecoveryState(input: ContextInput): string {
  return [
    `Schema-Version: ${ARTIFACT_SCHEMA_VERSION}`,
    `Issue: #${input.issue.number}`,
    `Branch: ${input.runtime.branch}`,
    `WorktreePath: ${input.runtime.worktreePath}`,
    `SprintId: ${input.runtime.sprintId}`,
    `Status: ${RECOVERY_STATUS_RUNNING}`,
    '',
  ].join('\n')
}

function formatRecoveryStateComplete(input: ContextInput): string {
  return [
    `Schema-Version: ${ARTIFACT_SCHEMA_VERSION}`,
    `Issue: #${input.issue.number}`,
    `Branch: ${input.runtime.branch}`,
    `WorktreePath: ${input.runtime.worktreePath}`,
    `SprintId: ${input.runtime.sprintId}`,
    `Status: ${RECOVERY_STATUS_COMPLETE}`,
    '',
  ].join('\n')
}

/**
 * Check whether an existing recovery state is compatible with the current input.
 * Returns null if compatible; returns an error string if incompatible.
 */
function checkRecoveryCompatibility(
  existing: RecoveryState,
  input: ContextInput,
  opts: GenerateOptions,
): string | null {
  if (existing.issue !== input.issue.number) {
    return `Recovery state is for issue #${existing.issue}, not #${input.issue.number}.`
  }
  if (existing.branch !== input.runtime.branch) {
    if (existing.status === RECOVERY_STATUS_COMPLETE) {
      return (
        `Recovery state shows a completed branch "${existing.branch}" ` +
        `that differs from requested branch "${input.runtime.branch}". ` +
        'Pass --force-replace to overwrite.'
      )
    }
    // running state with mismatched branch — refuse unless resuming explicitly
    if (!opts.resume) {
      return (
        `Recovery state shows an in-progress branch "${existing.branch}" ` +
        `that differs from requested branch "${input.runtime.branch}". ` +
        'Pass --resume to continue or --force-replace to overwrite.'
      )
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Artifact content builders — stable schema
// ---------------------------------------------------------------------------

function artifactHeader(schemaVersion: string): string {
  return `<!-- schema-version: ${schemaVersion} -->`
}

function bulletList(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`
  return items.map((item) => (item.startsWith('- ') ? item : `- ${item}`)).join('\n')
}

function issueContextContent(input: ContextInput): string {
  const { issue, runtime, content } = input
  return [
    artifactHeader(ARTIFACT_SCHEMA_VERSION),
    `# Issue #${issue.number}: ${issue.title}`,
    '',
    'This file is generated by the WivWav SDLC CLI. Prefer it over a fresh GitHub issue fetch unless you need live issue updates.',
    '',
    '## Metadata',
    '',
    `- Branch: ${runtime.branch}`,
    `- Worktree: ${runtime.worktreePath}`,
    `- Agent index: ${runtime.agentIndex}`,
    `- Sprint run: ${runtime.sprintId}`,
    `- Effort guidance: ${runtime.effort}`,
    `- Model guidance: ${runtime.model}`,
    `- Labels: ${issue.labels.join(', ') || 'none'}`,
    '',
    '## Acceptance Criteria',
    '',
    bulletList(
      content.acceptanceCriteria,
      'No structured acceptance criteria extracted. Re-check the issue body before proceeding.',
    ),
    '',
    '## Advisory Likely Files',
    '',
    'These hints come from deterministic filename matching. They are non-authoritative; verify by reading code before editing.',
    '',
    bulletList(content.likelyFiles, 'No likely-file hints generated. Use targeted `rg` searches after planning.'),
    '',
    '## Issue Body',
    '',
    issue.body.trim() || '_No issue body._',
    '',
  ].join('\n')
}

function workerContextContent(input: ContextInput): string {
  const { issue, runtime, content } = input
  return [
    artifactHeader(ARTIFACT_SCHEMA_VERSION),
    `# Worker Context: Issue #${issue.number}`,
    '',
    'Read this before any GitHub issue fetch. Use `.agents/issue-context.md` for the full issue body.',
    '',
    '## Startup',
    '',
    '- Read `.claude/core.md` and `.claude/roles/worker.md`.',
    '- Write a scoped plan before reading source files.',
    '- Treat likely-file hints as non-authoritative.',
    `- Completed issues must close on merge: use \`pnpm wivwav finish ${issue.number}\` without \`--refs\`.`,
    `- Use \`pnpm wivwav finish ${issue.number} --refs\` only for intentionally partial work that should leave the issue open.`,
    '',
    '## Acceptance Criteria',
    '',
    bulletList(
      content.acceptanceCriteria,
      'No structured acceptance criteria extracted. Re-check `.agents/issue-context.md`.',
    ),
    '',
    '## Likely Files',
    '',
    bulletList(content.likelyFiles, 'No likely-file hints generated.'),
    '',
    '## Model Guidance',
    '',
    `- Effort: ${runtime.effort}`,
    `- Model: ${runtime.model}`,
    '- Provider-specific model mapping belongs to the agent runtime, not this CLI.',
    '',
  ].join('\n')
}

function reviewContextContent(input: ContextInput): string {
  const { issue, content } = input
  return [
    artifactHeader(ARTIFACT_SCHEMA_VERSION),
    `# Review Context: Issue #${issue.number}`,
    '',
    'Use the precomputed acceptance criteria below when reviewing; fetch GitHub only if you need live issue updates.',
    '',
    '## Acceptance Criteria',
    '',
    bulletList(
      content.acceptanceCriteria,
      'No structured acceptance criteria extracted. Re-check `.agents/issue-context.md`.',
    ),
    '',
    '## Evidence Map Stub',
    '',
    content.acceptanceCriteria.length > 0
      ? content.acceptanceCriteria.map((c) => `${c} -> _pending evidence_`).join('\n')
      : '- _pending evidence_',
    '',
    '## Role Hints',
    '',
    '- Always read `.claude/roles/reviewer.md` and `.claude/roles/qa.md`.',
    '- Add accessibility/performance/docs-accuracy roles based on changed file paths.',
    '',
  ].join('\n')
}

function finishContextContent(input: ContextInput): string {
  const { issue, content } = input
  return [
    artifactHeader(ARTIFACT_SCHEMA_VERSION),
    `# Finish Context: Issue #${issue.number}`,
    '',
    'Use this packet for PR evidence and validation without fetching the issue again.',
    '',
    '## Required Validation',
    '',
    '- `pnpm typecheck`',
    '- `pnpm lint`',
    '- `pnpm build`',
    '- `pnpm test`',
    '',
    '## Acceptance Evidence',
    '',
    content.acceptanceCriteria.length > 0
      ? content.acceptanceCriteria.map((c) => `${c} -> _add proof line_`).join('\n')
      : '- _add proof line_',
    '',
    '## Issue Closure',
    '',
    `- Run \`pnpm wivwav finish ${issue.number}\` for completed work. The default uses GitHub closing keywords in the commit and PR body.`,
    `- Use \`pnpm wivwav finish ${issue.number} --refs\` only when the PR is intentionally partial and issue #${issue.number} should remain open.`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function resolveArtifactPath(worktreePath: string, relativePath: string): string {
  return join(worktreePath, relativePath)
}

function existingSchemaVersion(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const first = readFileSync(filePath, 'utf8').split('\n')[0] ?? ''
    const m = /schema-version:\s*(\S+)/.exec(first)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

function shouldSkipExisting(filePath: string, opts: Required<GenerateOptions>): boolean {
  if (opts.forceReplace) return false
  if (!opts.idempotent) return false
  const version = existingSchemaVersion(filePath)
  return version === ARTIFACT_SCHEMA_VERSION
}

function safeWrite(filePath: string, content: string, dryRun: boolean): void {
  if (dryRun) {
    console.log(`  [dry-run] write ${filePath}`)
    return
  }
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Artifact file definitions used by the generator.
 * Exported so callers can reference expected paths without hardcoding them.
 */
export const ARTIFACT_FILES = {
  issueContext: '.agents/issue-context.md',
  workerContext: '.agents/worker-context.md',
  reviewContext: '.agents/review-context.md',
  finishContext: '.agents/finish-context.md',
  recoveryState: '.agents/recovery-state.md',
} as const

/**
 * Generate or update the `.agents/` context artifacts for an issue.
 *
 * - Idempotent by default: skips files that already exist at the current schema version.
 * - Supports dry-run, resume, and force-replace modes.
 * - On failure, prior valid artifacts remain intact (writes are atomic per-file via sync I/O).
 */
export function writeContextArtifacts(input: ContextInput, opts: GenerateOptions = {}): void {
  const resolvedOpts: Required<GenerateOptions> = {
    dryRun: opts.dryRun ?? false,
    idempotent: opts.idempotent ?? true,
    resume: opts.resume ?? false,
    forceReplace: opts.forceReplace ?? false,
  }

  const { worktreePath } = input.runtime
  const { dryRun, forceReplace } = resolvedOpts

  // --- Recovery state check ---
  const recovPath = resolveArtifactPath(worktreePath, ARTIFACT_FILES.recoveryState)
  if (!dryRun && !forceReplace && existsSync(recovPath)) {
    const raw = readFileSync(recovPath, 'utf8')
    const existing = parseRecoveryState(raw)
    if (existing) {
      const problem = checkRecoveryCompatibility(existing, input, resolvedOpts)
      if (problem) {
        throw new ContextError(problem)
      }
    }
  }

  // --- Write recovery state (running) ---
  if (!dryRun) {
    safeWrite(recovPath, formatRecoveryState(input), false)
  } else {
    console.log(`  [dry-run] write ${recovPath}`)
  }

  // --- Write stable artifact files ---
  const artifacts: Array<[string, string]> = [
    [ARTIFACT_FILES.issueContext, issueContextContent(input)],
    [ARTIFACT_FILES.workerContext, workerContextContent(input)],
    [ARTIFACT_FILES.reviewContext, reviewContextContent(input)],
    [ARTIFACT_FILES.finishContext, finishContextContent(input)],
  ]

  for (const [relativePath, content] of artifacts) {
    const filePath = resolveArtifactPath(worktreePath, relativePath)
    if (shouldSkipExisting(filePath, resolvedOpts)) {
      if (dryRun) {
        console.log(`  [dry-run] skip ${filePath} (current schema version)`)
      }
      continue
    }
    safeWrite(filePath, content, dryRun)
  }

  // --- Mark recovery state complete ---
  if (!dryRun) {
    safeWrite(recovPath, formatRecoveryStateComplete(input), false)
  }
}

/**
 * Structured error for context-generation failures.
 * Callers should catch this to distinguish generation errors from other failures.
 */
export class ContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextError'
  }
}
