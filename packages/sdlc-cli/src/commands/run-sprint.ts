/**
 * wivwav run-sprint [issue-number] [--limit N] [--parallel N]
 *
 * Encodes the deterministic orchestration half of /wivwav-run-sprint:
 *   1. Select ready issues or a single explicit issue
 *   2. Verify issue readiness and acceptance criteria
 *   3. Claim issues, create isolated worktrees, write recovery state
 *   4. Print worker instructions for the agent layer
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { run } from '../lib/git.js'
import {
  type IssueData,
  type IssueSummary,
  CliError,
  editIssueLabels,
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
}

interface SprintTarget {
  issue: IssueData
  branch: string
  worktreePath: string
  agentIndex: number
}

function sprintRunId(now = new Date()): string {
  const isoMinute = now.toISOString().slice(0, 16)
  return `run-sprint/${isoMinute}`
}

function issueCommentDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function worktreePathFor(issue: IssueData): string {
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

function workerPrompt(target: SprintTarget, sprintId: string): string {
  return [
    'Read `.claude/core.md` and `.claude/roles/worker.md` before doing anything else.',
    'Keep startup context lean: do not read `AGENTS.md`, package manifests, or broad directory listings unless your plan identifies a specific need for them.',
    '',
    `You are implementing issue #${target.issue.number}.`,
    '',
    'First fetch the issue details:',
    `gh issue view ${target.issue.number} --json number,title,body,labels`,
    '',
    'Before reading source files, use the fetched issue details to write a scoped plan that names the likely files and the evidence you need from each one.',
    '',
    `Worktree: ${target.worktreePath}`,
    `Branch: ${target.branch}`,
    'Agent-Role: worker',
    `Agent-Index: ${target.agentIndex}`,
    `Sprint-Run: ${sprintId}`,
  ].join('\n')
}

function writeRecoveryState(target: SprintTarget, sprintId: string, dryRun: boolean): void {
  const statePath = `/tmp/wivwav-${target.issue.number}.md`
  const state = [
    `Issue: #${target.issue.number}`,
    `Branch: ${target.branch}`,
    `Worktree: ${target.worktreePath}`,
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

function createWorktree(target: SprintTarget, dryRun: boolean): void {
  if (dryRun) {
    console.log(`  [dry-run] git worktree add -b ${target.branch} ${target.worktreePath} origin/main`)
    return
  }

  mkdirSync(dirname(target.worktreePath), { recursive: true })
  run(`git worktree add -b ${target.branch} ${target.worktreePath} origin/main`)
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
    targets.push({
      issue,
      branch,
      worktreePath: worktreePathFor(issue),
      agentIndex,
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
    createWorktree(target, dryRun)
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
