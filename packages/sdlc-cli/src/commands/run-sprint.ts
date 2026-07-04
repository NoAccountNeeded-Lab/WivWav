/**
 * wivwav run-sprint [issue-number] [--limit N] [--parallel N]
 *
 * Encodes the deterministic orchestration half of /wivwav-run-sprint:
 *   1. Select ready issues or a single explicit issue (read-only candidate validation)
 *   2. Claim issues lazily — one at a time in sequential mode, up to the
 *      configured concurrency window in parallel mode
 *   3. Create isolated worktrees and write context artifacts only for claimed issues
 *   4. Print worker instructions for the agent layer
 *
 * Sequential mode claims and prepares exactly ONE issue per invocation. The
 * next issue is claimed only after the prior worker reaches a durable terminal
 * handoff. This ensures interruption leaves unclaimed candidates without
 * worktrees or mutated labels.
 *
 * Parallel mode claims up to the configured active concurrency window. Slot
 * replenishment happens lazily as workers complete, not up-front.
 *
 * Context artifact generation is delegated to lib/context.ts, which is also
 * used by `wivwav start` so both entry points produce the same artifact schema.
 */
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { repoRoot, run, tryRun } from '../lib/git.js'
import {
  type IssueData,
  type IssueSummary,
  CliError,
  editIssueLabels,
  extractAcceptanceCriteria,
  fetchIssue,
  hasAcceptanceCriteria,
  labelNames,
  listReadyIssues,
  postComment,
} from '../lib/github.js'
import { writeContextArtifacts } from '../lib/context.js'
import { buildBranchName, slugify } from './start.js'

export interface RunSprintOptions {
  issueNumber?: number
  limit?: number
  parallel?: number
  dryRun?: boolean
  effort?: EffortLevel
  model?: string
}

type EffortLevel = 'auto' | 'low' | 'standard' | 'high'

interface SprintTarget {
  issue: IssueData
  branch: string
  worktreePath: string
  agentIndex: number
  acceptanceCriteria: string[]
  effort: Exclude<EffortLevel, 'auto'>
  model: string
  likelyFiles: string[]
}

function sprintRunId(now = new Date()): string {
  const isoMinute = now.toISOString().slice(0, 16)
  return `run-sprint/${isoMinute}`
}

function issueCommentDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Worktree location relative to the repo root. */
function worktreeRelPath(issue: IssueData): string {
  return `.claude/worktrees/issue-${issue.number}-${slugify(issue.title)}`
}

function selectedIssueSummaries(opts: RunSprintOptions): IssueSummary[] {
  if (opts.issueNumber !== undefined) {
    return [{ number: opts.issueNumber, title: '' }]
  }

  const parallel = opts.parallel ?? 0
  const limit = opts.limit ?? 0
  const cap = parallel > 0 ? parallel : limit > 0 ? limit : 20
  return listReadyIssues(Math.max(cap, 1)).slice(0, cap)
}

function validateSprintIssue(issue: IssueData, explicit: boolean): string | null {
  const labels = labelNames(issue)
  if (issue.state !== 'OPEN') return `Issue #${issue.number} is not open.`
  if (labels.includes('status:in-progress')) return `Issue #${issue.number} is already in progress.`
  if (!explicit && !labels.includes('status:ready')) {
    return `Issue #${issue.number} is not labeled status:ready.`
  }
  if (!hasAcceptanceCriteria(issue.body)) {
    return `Issue #${issue.number} is missing acceptance criteria.`
  }
  return null
}

function effortForIssue(issue: IssueData, requested: EffortLevel = 'auto'): Exclude<EffortLevel, 'auto'> {
  if (requested !== 'auto') return requested

  const labels = labelNames(issue)
  const bodyLength = issue.body.length
  if (labels.some((label) => label === 'complexity:high' || label === 'risk')) return 'high'
  if (bodyLength > 4_000) return 'high'
  if (labels.some((label) => label.startsWith('docs') || label === 'type:docs')) return 'low'
  if (bodyLength < 1_200) return 'low'
  return 'standard'
}

/**
 * Resolve a provider-neutral model hint for the worker.
 *
 * The returned string is emitted verbatim into the worker prompt (`Model: <hint>`)
 * and into context artifacts. The sprint adapter (wivwav-run-sprint/SKILL.md)
 * reads this hint and passes it to the Agent tool's `model` parameter.
 *
 * Provider/subscription routing — mapping hints to provider-specific model IDs,
 * selecting tiers, and handling credentials — belongs exclusively to #465.
 * This function must never add provider names, subscription logic, or dispatch
 * implementation: it only normalises a caller-supplied hint or supplies a default.
 */
function modelForIssue(requested: string | undefined): string {
  return requested !== undefined && requested.trim() !== '' ? requested.trim() : 'sonnet'
}

function keywordCandidates(issue: IssueData): string[] {
  const source = [
    issue.title,
    issue.body,
    ...labelNames(issue),
  ].join(' ')
  const stopWords = new Set([
    'acceptance',
    'agent',
    'agents',
    'and',
    'body',
    'context',
    'criteria',
    'file',
    'files',
    'for',
    'from',
    'issue',
    'model',
    'prompt',
    'sprint',
    'that',
    'the',
    'this',
    'usage',
    'when',
    'with',
  ])
  return [...new Set(source.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])]
    .filter((word) => !stopWords.has(word))
    .slice(0, 30)
}

function likelyFileHints(issue: IssueData, dryRun: boolean): string[] {
  if (dryRun) return []

  const files = run('git ls-files')
    .split('\n')
    .filter((file) => file.trim() !== '')
  const keywords = keywordCandidates(issue)
  const scored = files
    .map((file) => {
      const normalized = file.toLowerCase()
      const score = keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 1 : 0), 0)
      return { file, score }
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, 10)

  return scored.map((candidate) => candidate.file)
}

/**
 * Build the worker instruction block printed to stdout by `run-sprint`.
 *
 * The `Model:` line is a provider-neutral hint consumed by the sprint adapter
 * (wivwav-run-sprint/SKILL.md). The adapter reads this line and passes it as
 * the `model` parameter when spawning the worker agent. Provider/subscription
 * routing lives in #465 — the adapter maps the hint to a provider-specific ID.
 *
 * Do not add provider names, credentials, or dispatch logic to this function.
 */
function workerPrompt(target: SprintTarget, sprintId: string): string {
  return [
    'Read `.claude/core.md` and `.claude/roles/worker.md` before doing anything else.',
    'Then read `.agents/worker-context.md` and `.agents/issue-context.md`; only call `gh issue view` if you need live issue updates.',
    'Keep startup context lean: do not read `AGENTS.md`, package manifests, or broad directory listings unless your plan identifies a specific need for them.',
    '',
    `You are implementing issue #${target.issue.number}.`,
    '',
    'Before reading source files, use the local context artifacts to write a scoped plan that names the likely files and the evidence you need from each one.',
    '',
    `Worktree: ${target.worktreePath}`,
    `Branch: ${target.branch}`,
    'Agent-Role: worker',
    `Agent-Index: ${target.agentIndex}`,
    `Sprint-Run: ${sprintId}`,
    `Effort: ${target.effort}`,
    `Model: ${target.model}`,
  ].join('\n')
}

/**
 * Attempt to atomically claim an issue by verifying its current state
 * immediately before mutation. Returns true if successfully claimed, false if
 * another runner won the race (issue is already in-progress or no longer ready).
 * Throws on unexpected errors.
 */
function tryClaimIssue(
  target: SprintTarget,
  sprintId: string,
  today: string,
  dryRun: boolean,
  explicit: boolean,
): boolean {
  if (dryRun) {
    console.log(`  [dry-run] claim issue #${target.issue.number}`)
    return true
  }

  // Re-fetch issue state at claim time to detect concurrent runners.
  const fresh = fetchIssue(target.issue.number)
  const freshProblem = validateSprintIssue(fresh, explicit)
  if (freshProblem !== null) {
    console.warn(`  Skipping issue #${fresh.number} at claim time: ${freshProblem} (another runner may have claimed it)`)
    return false
  }

  const comment = [
    `🤖 **orchestrator[0]** · \`run-sprint\` · ${today}`,
    '',
    `Sprint worker starting. Branch: ${target.branch} · Worktree: ${target.worktreePath} · Sprint: ${sprintId}`,
  ].join('\n')

  editIssueLabels(target.issue.number, {
    add: ['status:in-progress'],
    remove: ['status:ready'],
  })
  postComment(target.issue.number, comment)
  return true
}

/**
 * Write the orchestrator-level recovery state to `/tmp/wivwav-{N}.md`.
 *
 * This lives outside the worktree on purpose: the agent layer (and the
 * run-sprint skill) read it to track sprint outcome and resume even after the
 * worktree — and its in-worktree `.agents/recovery-state.md` — has been removed.
 * `Owner: CLI` records that the CLI is the single owner of this issue's branch
 * and worktree (see assertWorktreeFree).
 */
function writeRecoveryState(target: SprintTarget, sprintId: string, dryRun: boolean): void {
  const statePath = `/tmp/wivwav-${target.issue.number}.md`
  const state = [
    `Issue: #${target.issue.number}`,
    `Branch: ${target.branch}`,
    `Worktree: ${target.worktreePath}`,
    `Owner: CLI`,
    `Sprint-Run: ${sprintId}`,
    'Status: running',
    '',
  ].join('\n')

  if (dryRun) {
    console.log(`  [dry-run] write ${statePath}`)
    return
  }

  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, state)
}

const ENV_FILES_TO_COPY = [
  'apps/api/.env',
  'apps/api/.env.local',
  'apps/scraper/.env',
  'apps/web/.env.local',
  'packages/db/.env',
]

function copyEnvFiles(root: string, worktreePath: string, dryRun: boolean): void {
  for (const rel of ENV_FILES_TO_COPY) {
    const src = join(root, rel)
    const dest = join(worktreePath, rel)
    if (!existsSync(src)) continue
    if (dryRun) {
      console.log(`  [dry-run] cp ${rel} → ${worktreePath}/${rel}`)
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }
}

/**
 * Verify that the worktree path and branch are not already in use.
 * Throws a CliError with recovery guidance when a conflict is detected.
 * The CLI is the single owner of branch and worktree creation — this guard
 * ensures a second worktree or branch is never created for the same issue.
 */
function assertWorktreeFree(target: SprintTarget): void {
  const absolutePath = target.worktreePath

  // Check for a stale or pre-existing worktree at the target path.
  if (existsSync(absolutePath)) {
    throw new CliError(
      `Worktree path already exists: ${absolutePath}\n` +
      `This indicates a stale or interrupted sprint run for issue #${target.issue.number}.\n` +
      `Recovery: remove the path with \`git worktree remove --force ${absolutePath} && git worktree prune\`, ` +
      `then re-run \`pnpm wivwav run-sprint ${target.issue.number}\`.`,
    )
  }

  // Check for a pre-existing local branch of the same name.
  const branchExists = tryRun(`git rev-parse --verify refs/heads/${target.branch}`).ok
  if (branchExists) {
    throw new CliError(
      `Branch already exists: ${target.branch}\n` +
      `This indicates a previous sprint prepared issue #${target.issue.number}.\n` +
      `Recovery: delete the branch with \`git branch -D ${target.branch}\`, ` +
      `then re-run \`pnpm wivwav run-sprint ${target.issue.number}\`.`,
    )
  }
}

function createWorktree(target: SprintTarget, root: string, dryRun: boolean): void {
  if (dryRun) {
    console.log(`  [dry-run] git worktree add -b ${target.branch} ${target.worktreePath} origin/main`)
    copyEnvFiles(root, target.worktreePath, dryRun)
    return
  }

  assertWorktreeFree(target)
  mkdirSync(dirname(target.worktreePath), { recursive: true })
  run(`git worktree add -b ${target.branch} ${target.worktreePath} origin/main`)
  copyEnvFiles(root, target.worktreePath, dryRun)
}

function markMissingAcceptanceCriteria(issue: IssueData, today: string, dryRun: boolean): void {
  const comment = [
    `🤖 **orchestrator[0]** · \`run-sprint\` · ${today}`,
    '',
    'Issue is missing acceptance criteria. Add them before this issue can be picked up by a sprint worker.',
  ].join('\n')

  if (dryRun) {
    console.log(`  [dry-run] mark issue #${issue.number} status:stuck for missing AC`)
    return
  }

  editIssueLabels(issue.number, {
    add: ['status:stuck'],
    remove: ['status:ready'],
  })
  postComment(issue.number, comment)
}

/**
 * Build a validated candidate from an issue summary. Returns the SprintTarget
 * if the issue passes all read-only preflight checks, or null if it should be
 * skipped (with side-effects already logged/applied for skips such as missing AC).
 * Does NOT claim or mutate issue state beyond marking stuck for missing AC.
 */
function buildCandidate(
  summary: IssueSummary,
  explicit: boolean,
  agentIndex: number,
  opts: RunSprintOptions,
  root: string,
  today: string,
): SprintTarget | null {
  const issue = fetchIssue(summary.number)
  const problem = validateSprintIssue(issue, explicit)
  if (problem !== null) {
    console.warn(`\nSkipping issue #${issue.number}: ${problem}`)
    if (problem.includes('missing acceptance criteria')) {
      markMissingAcceptanceCriteria(issue, today, opts.dryRun ?? false)
    }
    return null
  }

  const branch = buildBranchName(issue.number, issue.title)
  const effort = effortForIssue(issue, opts.effort ?? 'auto')
  return {
    issue,
    branch,
    worktreePath: resolve(root, worktreeRelPath(issue)),
    agentIndex,
    acceptanceCriteria: extractAcceptanceCriteria(issue.body),
    effort,
    model: modelForIssue(opts.model),
    likelyFiles: likelyFileHints(issue, opts.dryRun ?? false),
  }
}

/**
 * Claim, prepare, and hand off a single sprint target.
 * Returns true if the target was successfully claimed and prepared, false if
 * another runner claimed it first (race condition).
 */
function claimAndPrepare(
  target: SprintTarget,
  sprintId: string,
  today: string,
  dryRun: boolean,
  explicit: boolean,
  root: string,
): boolean {
  const claimed = tryClaimIssue(target, sprintId, today, dryRun, explicit)
  if (!claimed) return false

  console.log(`\n#${target.issue.number}: ${target.issue.title}`)
  console.log(`  Branch: ${target.branch}`)
  console.log(`  Worktree: ${target.worktreePath}`)
  console.log(`  Effort: ${target.effort}`)
  console.log(`  Model: ${target.model}`)
  createWorktree(target, root, dryRun)
  writeContextArtifacts(
    {
      issue: {
        number: target.issue.number,
        title: target.issue.title,
        body: target.issue.body,
        labels: labelNames(target.issue),
      },
      repo: { root },
      runtime: {
        worktreePath: target.worktreePath,
        branch: target.branch,
        sprintId,
        effort: target.effort,
        model: target.model,
        agentIndex: target.agentIndex,
      },
      content: {
        acceptanceCriteria: target.acceptanceCriteria,
        likelyFiles: target.likelyFiles,
      },
    },
    { dryRun },
  )
  writeRecoveryState(target, sprintId, dryRun)
  return true
}

export async function runSprintCommand(opts: RunSprintOptions = {}): Promise<void> {
  const explicit = opts.issueNumber !== undefined
  const parallel = explicit ? 0 : opts.parallel ?? 0
  const mode = explicit ? 'single' : parallel > 0 ? 'parallel' : 'sequential'
  const sprintId = sprintRunId()
  const today = issueCommentDate()
  const dryRun = opts.dryRun ?? false
  // Anchor all worktree paths on the repo root, not process.cwd(): pnpm sets
  // the cwd to packages/sdlc-cli, so the CLI is the single owner of one
  // worktree per issue at <repoRoot>/.claude/worktrees/.
  const root = repoRoot()

  console.log(`\nSprint mode: ${mode}`)
  console.log(`Sprint run: ${sprintId}`)

  if (dryRun) {
    console.log('[dry-run] No GitHub labels, comments, or worktrees will be changed.')
  } else {
    run('git worktree prune')
    run('git fetch origin main')
  }

  const summaries = selectedIssueSummaries(opts)
  if (summaries.length === 0) {
    console.log('\nNo issues labeled status:ready. Nothing to do.')
    return
  }

  // Phase 1: Validate candidates read-only. No mutations beyond marking stuck
  // for missing AC. Collect all valid candidates before claiming any.
  const candidates: SprintTarget[] = []
  for (const [index, summary] of summaries.entries()) {
    const agentIndex = mode === 'parallel' ? index + 1 : 1
    const candidate = buildCandidate(summary, explicit, agentIndex, opts, root, today)
    if (candidate !== null) {
      candidates.push(candidate)
    }
  }

  if (candidates.length === 0) {
    throw new CliError('No selected issues passed sprint pre-flight checks.')
  }

  // Phase 2: Claim issues lazily.
  //
  // Sequential mode (including single): claim and prepare exactly ONE issue.
  // The next issue is only claimed after the prior worker reaches a durable
  // terminal handoff — by design, this CLI invocation handles only one issue
  // so the next invocation naturally picks the next ready issue.
  //
  // Parallel mode: claim up to the configured concurrency window. Slot
  // replenishment happens lazily as workers complete.
  const claimCount = mode === 'parallel' ? parallel : 1
  const toProcess = candidates.slice(0, claimCount)
  const skipped = candidates.slice(claimCount)

  const claimedTargets: SprintTarget[] = []

  console.log(
    `\nSelected: ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}, ` +
    `claiming: ${toProcess.length}` +
    (skipped.length > 0 ? `, deferred: ${skipped.length}` : ''),
  )

  console.log(`\nClaiming ${toProcess.length} issue${toProcess.length === 1 ? '' : 's'}...`)
  for (const target of toProcess) {
    const claimed = claimAndPrepare(target, sprintId, today, dryRun, explicit, root)
    if (claimed) {
      claimedTargets.push(target)
    }
  }

  if (claimedTargets.length === 0) {
    throw new CliError(
      mode === 'parallel'
        ? 'No issues could be claimed — all candidates were taken by concurrent runners.'
        : 'No issues could be claimed — the candidate for this run was already claimed by a concurrent runner. Re-run to try the next available issue.',
    )
  }

  console.log('\nWorker instructions:')
  for (const target of claimedTargets) {
    console.log('\n---')
    console.log(workerPrompt(target, sprintId))
  }

  console.log(
    `\nStarted: ${claimedTargets.length} worker${claimedTargets.length === 1 ? '' : 's'}` +
    (skipped.length > 0
      ? `. ${skipped.length} deferred candidate${skipped.length === 1 ? '' : 's'} left unclaimed — run again after the current worker completes to pick up the next issue.`
      : '.'),
  )

  console.log('\nNext step: run an agent in each listed worktree using the matching worker instructions.')
}
