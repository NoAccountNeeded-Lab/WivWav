/**
 * wivwav start <issue-number>
 *
 * Encodes the "Start an issue" section of AGENTS.md:
 *   1. Fetch issue and verify it is ready
 *   2. Verify no acceptance-criteria gap
 *   3. Derive branch name from title (or accept --branch override)
 *   4. Validate branch naming convention
 *   5. Label status:in-progress, create branch, write context artifacts, post check-in comment
 *
 * Context artifact generation is delegated to lib/context.ts so that direct
 * `start` and sprint-worker preparation produce the same artifact schema.
 */
import { fetchIssue, editIssueLabels, postComment, CliError, labelNames, extractAcceptanceCriteria } from '../lib/github.js'
import { run, isDirty, repoRoot } from '../lib/git.js'
import {
  validateIssueForStart,
  validateBranchName,
  mergeResults,
  formatResult,
} from '../lib/validation.js'
import { writeContextArtifacts } from '../lib/context.js'

export interface StartOptions {
  branch?: string
  dryRun?: boolean
  agentRole?: string
  agentIndex?: number
  /** Effort guidance passed into context artifacts (default: 'standard'). */
  effort?: 'low' | 'standard' | 'high'
  /** Model guidance passed into context artifacts (default: 'sonnet'). */
  model?: string
  /**
   * Bypass recovery-state compatibility checks entirely and overwrite all
   * `.agents/` artifacts unconditionally. Escape hatch for mismatch cases
   * that are not automatically resolved (e.g. a lingering `running` recovery
   * state left behind for a different issue).
   */
  forceReplace?: boolean
  /**
   * Resume mode: continue past an in-progress recovery state left by an
   * earlier run for a different branch, instead of failing closed.
   */
  resume?: boolean
}

/**
 * Slugify an issue title for use in a branch name.
 * Keeps only alphanumeric, hyphens, and converts spaces to hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '')
}

/**
 * Derive the branch prefix from the issue title's conventional prefix.
 * Titles that start with "feat", "fix", "docs", or "chore" (plus colon or paren)
 * map to the corresponding prefix. Anything else defaults to "feat".
 */
export function deriveBranchPrefix(title: string): string {
  const lower = title.toLowerCase()
  if (/^fix[(:/ ]/.test(lower) || lower.startsWith('bug')) return 'fix'
  if (/^docs[(:/ ]/.test(lower)) return 'docs'
  if (/^chore[(:/ ]/.test(lower) || /^refactor[(:/ ]/.test(lower)) return 'chore'
  return 'feat'
}

/**
 * Build the canonical branch name for an issue.
 * Format: `{prefix}/issue-{N}-{slug}`
 */
export function buildBranchName(issueNumber: number, issueTitle: string): string {
  const prefix = deriveBranchPrefix(issueTitle)
  const slug = slugify(issueTitle.replace(/^[a-z]+\([^)]*\):\s*/i, '').replace(/^[a-z]+:\s*/i, ''))
  return `${prefix}/issue-${issueNumber}-${slug}`
}

/**
 * Strip characters that are unsafe in shell from a git branch name.
 * Only alphanumeric, slash, hyphen, underscore, and dot are allowed.
 * Applied to user-provided --branch overrides before passing to shell.
 */
export function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9/._-]/g, '')
}

/**
 * Build a deterministic sprint ID for a direct `start` invocation.
 * Uses a `start/` prefix to distinguish from `run-sprint/` IDs.
 */
function startSprintId(now = new Date()): string {
  const isoMinute = now.toISOString().slice(0, 16)
  return `start/${isoMinute}`
}

export async function startCommand(issueNumber: number, opts: StartOptions = {}): Promise<void> {
  console.log(`\nFetching issue #${issueNumber}...`)
  const issue = fetchIssue(issueNumber)
  console.log(`  Title: ${issue.title}`)

  // Validate issue state
  const issueValidation = validateIssueForStart(issue)
  if (!issueValidation.ok) {
    console.error('\nPre-flight checks failed:')
    console.error(formatResult(issueValidation))
    throw new CliError('Cannot start: pre-flight checks failed.')
  }
  if (issueValidation.warnings.length > 0) {
    console.warn('\nWarnings:')
    console.warn(formatResult(issueValidation))
  }

  // Derive branch name; sanitize any user-provided override before shell use
  const branchName = sanitizeBranchName(opts.branch ?? buildBranchName(issue.number, issue.title))
  console.log(`\nBranch: ${branchName}`)

  // Validate branch name against convention
  const branchValidation = validateBranchName(branchName, issueNumber)
  const allValidation = mergeResults(issueValidation, branchValidation)
  if (!allValidation.ok) {
    console.error('\nBranch name validation failed:')
    console.error(formatResult(allValidation))
    throw new CliError('Cannot start: branch name does not conform to convention.')
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Would perform:')
    console.log(
      `  gh issue edit ${issueNumber} --add-label status:in-progress --remove-label status:ready`,
    )
    console.log(`  git fetch origin main && git checkout -b ${branchName} origin/main`)
    console.log(`  write .agents/ context artifacts in current worktree`)
    console.log(`  gh issue comment ${issueNumber} --body "Starting work..."`)
    return
  }

  if (isDirty()) {
    throw new CliError(
      'Working tree has uncommitted changes. Commit, stash, or clean them before starting a new issue.',
    )
  }

  // Fetch latest main and create the new branch from it, regardless of current branch
  console.log('\nFetching latest main...')
  run('git fetch origin main')
  console.log(`Creating branch ${branchName} from origin/main...`)
  run(`git checkout -b ${branchName} origin/main`)

  // Label the issue
  console.log('Labeling issue status:in-progress...')
  editIssueLabels(issueNumber, {
    add: ['status:in-progress'],
    remove: ['status:ready'],
  })

  // pnpm --filter changes process.cwd(); anchor artifacts on the Git worktree root.
  const root = repoRoot()

  // Write context artifacts to the current worktree root.
  console.log('Writing .agents/ context artifacts...')
  writeContextArtifacts(
    {
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: labelNames(issue),
      },
      repo: { root },
      runtime: {
        worktreePath: root,
        branch: branchName,
        sprintId: startSprintId(),
        effort: opts.effort ?? 'standard',
        model: opts.model ?? 'sonnet',
        agentIndex: opts.agentIndex ?? 1,
      },
      content: {
        acceptanceCriteria: extractAcceptanceCriteria(issue.body),
        likelyFiles: [],
      },
    },
    { forceReplace: opts.forceReplace ?? false, resume: opts.resume ?? false },
  )

  // Post check-in comment
  const today = new Date().toISOString().slice(0, 10)
  const role = opts.agentRole ? `**${opts.agentRole}[${opts.agentIndex ?? 1}]**` : 'worker'
  const commentBody = [
    `🤖 ${role} · \`wivwav-start\` · ${today}`,
    '',
    `Starting work on issue #${issueNumber}. Branch: \`${branchName}\``,
  ].join('\n')

  console.log('Posting check-in comment...')
  postComment(issueNumber, commentBody)

  console.log(`\nReady. Branch "${branchName}" is checked out.`)
  console.log(`Run "pnpm check:affected" for fast iteration checks.`)
  console.log(
    `When done, run "pnpm wivwav review ${issueNumber}" then "pnpm wivwav finish ${issueNumber}".`,
  )
}
