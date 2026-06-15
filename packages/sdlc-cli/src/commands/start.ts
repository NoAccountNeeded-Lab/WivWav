/**
 * wivwav start <issue-number>
 *
 * Encodes the "Start an issue" section of AGENTS.md:
 *   1. Fetch issue and verify it is ready
 *   2. Verify no acceptance-criteria gap
 *   3. Derive branch name from title (or accept --branch override)
 *   4. Validate branch naming convention
 *   5. Label status:in-progress, create branch, post check-in comment
 */
import { fetchIssue, editIssueLabels, postComment, CliError } from '../lib/github.js'
import { run } from '../lib/git.js'
import {
  validateIssueForStart,
  validateBranchName,
  mergeResults,
  formatResult,
} from '../lib/validation.js'

export interface StartOptions {
  branch?: string
  dryRun?: boolean
  agentRole?: string
  agentIndex?: number
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
export function buildBranchName(
  issueNumber: number,
  issueTitle: string,
): string {
  const prefix = deriveBranchPrefix(issueTitle)
  const slug = slugify(issueTitle.replace(/^[a-z]+\([^)]*\):\s*/i, '').replace(/^[a-z]+:\s*/i, ''))
  return `${prefix}/issue-${issueNumber}-${slug}`
}

export async function startCommand(
  issueNumber: number,
  opts: StartOptions = {},
): Promise<void> {
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

  // Derive branch name
  const branchName = opts.branch ?? buildBranchName(issue.number, issue.title)
  console.log(`\nBranch: ${branchName}`)

  // Validate branch name against convention
  const branchValidation = validateBranchName(branchName, issueNumber)
  const allValidation = mergeResults(branchValidation)
  if (!allValidation.ok) {
    console.error('\nBranch name validation failed:')
    console.error(formatResult(allValidation))
    throw new CliError('Cannot start: branch name does not conform to convention.')
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Would perform:')
    console.log(`  gh issue edit ${issueNumber} --add-label status:in-progress --remove-label status:ready`)
    console.log(`  git fetch origin main && git checkout -b ${branchName} origin/main`)
    console.log(`  gh issue comment ${issueNumber} --body "Starting work..."`)
    return
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
  console.log(`When done, run "pnpm wivwav review ${issueNumber}" then "pnpm wivwav finish ${issueNumber}".`)
}
