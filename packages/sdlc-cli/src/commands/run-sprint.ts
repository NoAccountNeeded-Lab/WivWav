/**
 * wivwav run-sprint [issue-number] [--limit N] [--parallel N]
 *
 * Encodes the deterministic orchestration half of /wivwav-run-sprint:
 *   1. Select ready issues or a single explicit issue
 *   2. Verify issue readiness and acceptance criteria
 *   3. Claim issues, create isolated worktrees, write recovery state
 *   4. Print worker instructions for the agent layer
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
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

function modelForIssue(requested: string | undefined): string {
  return requested?.trim() !== undefined && requested.trim() !== '' ? requested.trim() : 'sonnet'
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

function bulletList(items: string[], fallback: string): string {
  if (items.length === 0) return `- ${fallback}`
  return items.map((item) => (item.startsWith('- ') ? item : `- ${item}`)).join('\n')
}

function writeWorktreeFile(target: SprintTarget, relativePath: string, contents: string, dryRun: boolean): void {
  const filePath = `${target.worktreePath}/${relativePath}`
  if (dryRun) {
    console.log(`  [dry-run] write ${filePath}`)
    return
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents)
}

function issueContext(target: SprintTarget, sprintId: string): string {
  return [
    `# Issue #${target.issue.number}: ${target.issue.title}`,
    '',
    'This file is generated by `pnpm wivwav run-sprint`. Prefer it over a fresh GitHub issue fetch unless you need live issue updates.',
    '',
    '## Metadata',
    '',
    `- Branch: ${target.branch}`,
    `- Worktree: ${target.worktreePath}`,
    `- Agent index: ${target.agentIndex}`,
    `- Sprint run: ${sprintId}`,
    `- Effort guidance: ${target.effort}`,
    `- Model guidance: ${target.model}`,
    `- Labels: ${labelNames(target.issue).join(', ') || 'none'}`,
    '',
    '## Acceptance Criteria',
    '',
    bulletList(target.acceptanceCriteria, 'No structured acceptance criteria extracted. Re-check the issue body before proceeding.'),
    '',
    '## Advisory Likely Files',
    '',
    'These hints come from deterministic filename matching. They are non-authoritative; verify by reading code before editing.',
    '',
    bulletList(target.likelyFiles, 'No likely-file hints generated. Use targeted `rg` searches after planning.'),
    '',
    '## Issue Body',
    '',
    target.issue.body.trim() || '_No issue body._',
    '',
  ].join('\n')
}

function workerContext(target: SprintTarget): string {
  return [
    `# Worker Context: Issue #${target.issue.number}`,
    '',
    'Read this before any GitHub issue fetch. Use `.agents/issue-context.md` for the full issue body.',
    '',
    '## Startup',
    '',
    '- Read `.claude/core.md` and `.claude/roles/worker.md`.',
    '- Write a scoped plan before reading source files.',
    '- Treat likely-file hints as non-authoritative.',
    `- Completed issues must close on merge: use \`pnpm wivwav finish ${target.issue.number}\` without \`--refs\`.`,
    `- Use \`pnpm wivwav finish ${target.issue.number} --refs\` only for intentionally partial work that should leave the issue open.`,
    '- Append your model and token usage to `.agents/usage-report.md` before finishing.',
    '',
    '## Acceptance Criteria',
    '',
    bulletList(target.acceptanceCriteria, 'No structured acceptance criteria extracted. Re-check `.agents/issue-context.md`.'),
    '',
    '## Likely Files',
    '',
    bulletList(target.likelyFiles, 'No likely-file hints generated.'),
    '',
    '## Model Guidance',
    '',
    `- Effort: ${target.effort}`,
    `- Model: ${target.model}`,
    '- Provider-specific model mapping belongs to the agent runtime, not this CLI.',
    '',
  ].join('\n')
}

function reviewContext(target: SprintTarget): string {
  return [
    `# Review Context: Issue #${target.issue.number}`,
    '',
    'Use the precomputed acceptance criteria below when reviewing; fetch GitHub only if you need live issue updates.',
    '',
    '## Acceptance Criteria',
    '',
    bulletList(target.acceptanceCriteria, 'No structured acceptance criteria extracted. Re-check `.agents/issue-context.md`.'),
    '',
    '## Evidence Map Stub',
    '',
    target.acceptanceCriteria.length > 0
      ? target.acceptanceCriteria.map((criterion) => `${criterion} -> _pending evidence_`).join('\n')
      : '- _pending evidence_',
    '',
    '## Role Hints',
    '',
    '- Always read `.claude/roles/reviewer.md` and `.claude/roles/qa.md`.',
    '- Add accessibility/performance/docs-accuracy roles based on changed file paths.',
    '',
  ].join('\n')
}

function finishContext(target: SprintTarget): string {
  return [
    `# Finish Context: Issue #${target.issue.number}`,
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
    target.acceptanceCriteria.length > 0
      ? target.acceptanceCriteria.map((criterion) => `${criterion} -> _add proof line_`).join('\n')
      : '- _add proof line_',
    '',
    '## Issue Closure',
    '',
    `- Run \`pnpm wivwav finish ${target.issue.number}\` for completed work. The default uses GitHub closing keywords in the commit and PR body.`,
    `- Use \`pnpm wivwav finish ${target.issue.number} --refs\` only when the PR is intentionally partial and issue #${target.issue.number} should remain open.`,
    '',
    '## Usage Reporting',
    '',
    '- Update `.agents/usage-report.md` with model and token usage before opening the PR.',
    '',
  ].join('\n')
}

function usageReport(target: SprintTarget, sprintId: string): string {
  return [
    `# Usage Report: Issue #${target.issue.number}`,
    '',
    'Purpose: record model and token usage by phase so sprint costs can be compared by issue area.',
    '',
    '## Metadata',
    '',
    `- Sprint run: ${sprintId}`,
    `- Branch: ${target.branch}`,
    `- Worktree: ${target.worktreePath}`,
    `- Effort guidance: ${target.effort}`,
    `- Model guidance: ${target.model}`,
    `- Labels: ${labelNames(target.issue).join(', ') || 'none'}`,
    '',
    '## Phase Usage',
    '',
    '| Phase | Agent role/index | Provider | Model | Input tokens | Output tokens | Cache read tokens | Cache write tokens | Tool calls | Notes |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    `| run-sprint | orchestrator/0 | n/a | n/a | 0 | 0 | 0 | 0 | deterministic CLI | Generated context artifacts. |`,
    '| worker | worker/1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill before finish. |',
    '| reviewer | reviewer/TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill after review. |',
    '| finish | worker/1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Fill after PR creation. |',
    '',
    '## Reporting Notes',
    '',
    '- Use provider-reported token counts when available.',
    '- If a runtime does not expose token usage, write `unavailable` and include the model name.',
    '- Keep provider-specific model names here; keep workflow prompts provider-neutral.',
    '',
  ].join('\n')
}

function writeContextArtifacts(target: SprintTarget, sprintId: string, dryRun: boolean): void {
  writeWorktreeFile(target, '.agents/issue-context.md', issueContext(target, sprintId), dryRun)
  writeWorktreeFile(target, '.agents/worker-context.md', workerContext(target), dryRun)
  writeWorktreeFile(target, '.agents/review-context.md', reviewContext(target), dryRun)
  writeWorktreeFile(target, '.agents/finish-context.md', finishContext(target), dryRun)
  writeWorktreeFile(target, '.agents/usage-report.md', usageReport(target, sprintId), dryRun)
}

function workerPrompt(target: SprintTarget, sprintId: string): string {
  return [
    'Read `.claude/core.md` and `.claude/roles/worker.md` before doing anything else.',
    'Then read `.agents/worker-context.md` and `.agents/issue-context.md`; only call `gh issue view` if you need live issue updates.',
    'Keep startup context lean: do not read `AGENTS.md`, package manifests, or broad directory listings unless your plan identifies a specific need for them.',
    '',
    `You are implementing issue #${target.issue.number}.`,
    '',
    'Before reading source files, use the local context artifacts to write a scoped plan that names the likely files and the evidence you need from each one.',
    'Track model and token usage in `.agents/usage-report.md` before finishing so sprint cost can be reviewed by issue area.',
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

function claimIssue(target: SprintTarget, sprintId: string, today: string, dryRun: boolean): void {
  const comment = [
    `🤖 **orchestrator[0]** · \`run-sprint\` · ${today}`,
    '',
    `Sprint worker starting. Branch: ${target.branch} · Worktree: ${target.worktreePath} · Sprint: ${sprintId}`,
  ].join('\n')

  if (dryRun) {
    console.log(`  [dry-run] claim issue #${target.issue.number}`)
    return
  }

  editIssueLabels(target.issue.number, {
    add: ['status:in-progress'],
    remove: ['status:ready'],
  })
  postComment(target.issue.number, comment)
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

  const targets: SprintTarget[] = []
  for (const [index, summary] of summaries.entries()) {
    const issue = fetchIssue(summary.number)
    const problem = validateSprintIssue(issue, explicit)
    if (problem !== null) {
      console.warn(`\nSkipping issue #${issue.number}: ${problem}`)
      if (problem.includes('missing acceptance criteria')) {
        markMissingAcceptanceCriteria(issue, today, dryRun)
      }
      continue
    }

    const branch = buildBranchName(issue.number, issue.title)
    const agentIndex = mode === 'parallel' ? index + 1 : 1
    const effort = effortForIssue(issue, opts.effort ?? 'auto')
    targets.push({
      issue,
      branch,
      worktreePath: resolve(root, worktreeRelPath(issue)),
      agentIndex,
      acceptanceCriteria: extractAcceptanceCriteria(issue.body),
      effort,
      model: modelForIssue(opts.model),
      likelyFiles: likelyFileHints(issue, dryRun),
    })
  }

  if (targets.length === 0) {
    throw new CliError('No selected issues passed sprint pre-flight checks.')
  }

  console.log(`\nPreparing ${targets.length} worker${targets.length === 1 ? '' : 's'}...`)
  for (const target of targets) {
    console.log(`\n#${target.issue.number}: ${target.issue.title}`)
    console.log(`  Branch: ${target.branch}`)
    console.log(`  Worktree: ${target.worktreePath}`)
    console.log(`  Effort: ${target.effort}`)
    console.log(`  Model: ${target.model}`)
    createWorktree(target, root, dryRun)
    writeContextArtifacts(target, sprintId, dryRun)
    writeRecoveryState(target, sprintId, dryRun)
    claimIssue(target, sprintId, today, dryRun)
  }

  console.log('\nWorker instructions:')
  for (const target of targets) {
    console.log('\n---')
    console.log(workerPrompt(target, sprintId))
  }

  console.log('\nNext step: run an agent in each listed worktree using the matching worker instructions.')
}
