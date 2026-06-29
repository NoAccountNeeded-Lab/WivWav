/**
 * wivwav finish <issue-number>
 *
 * Encodes the "Finish an issue" section of AGENTS.md:
 *   0. Fetch origin/main and rebase — fail closed when branch is behind
 *   1. Full validation (typecheck + lint + test)
 *   2. Detect staged / relevant files — fail on unstaged or untracked files
 *   3. Commit with required format and attribution trailers
 *   4. Push to origin
 *   5. Open a draft PR with acceptance evidence placeholders
 */
import {
  run,
  tryRun,
  currentBranch,
  isProtectedBranch,
  isBehindOriginMain,
  commitsAheadOfMain,
  stagedFiles,
  changedFiles,
  dirtyFiles,
  expectedPrefix,
} from '../lib/git.js'
import {
  fetchIssue,
  createDraftPr,
  findExistingPr,
  updatePrBody,
  hasAcceptanceCriteria,
  labelNames,
  editIssueLabels,
  CliError,
} from '../lib/github.js'

export interface FinishOptions {
  /** Commit type prefix. Defaults to "feat". */
  commitType?: string
  /** Commit scope. Defaults to derived from changed files. */
  commitScope?: string
  /** Short description for commit and PR title. Defaults to issue title slug. */
  description?: string
  /** Whether this commit fully resolves the issue (uses "fixes" instead of "refs"). */
  fixes?: boolean
  /** Agent attribution trailers. */
  agentRole?: string
  agentIndex?: number
  sprintRun?: string
  coAuthoredBy?: string
  /** Skip final validation (for use when caller already validated). */
  skipValidation?: boolean
  dryRun?: boolean
}

/** Derive a commit scope from a list of changed file paths. */
export function deriveScope(files: string[]): string {
  if (files.length === 0) return 'sdlc'
  const prefixes: Record<string, string> = {
    'apps/api/': 'api',
    'apps/web/': 'web',
    'apps/scraper/': 'scraper',
    'packages/db/': 'db',
    'packages/agents/': 'agents',
    'packages/queue/': 'queue',
    'packages/types/': 'types',
    'packages/sdlc-cli/': 'sdlc-cli',
    '.claude/': 'sdlc',
    'scripts/': 'scripts',
  }
  const counts: Record<string, number> = {}
  for (const file of files) {
    for (const [prefix, scope] of Object.entries(prefixes)) {
      if (file.startsWith(prefix)) {
        counts[scope] = (counts[scope] ?? 0) + 1
        break
      }
    }
  }
  if (Object.keys(counts).length === 0) return 'misc'
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return top !== undefined ? top[0] : 'misc'
}

/** Slugify a title to a short commit description phrase. */
export function titleToDescription(title: string): string {
  // Strip conventional-commit prefix: "feat(scope): " or "feat: "
  const stripped = title.replace(/^[a-z]+(\([^)]*\))?:\s*/i, '').trim()
  return stripped.charAt(0).toLowerCase() + stripped.slice(1)
}

/** Build acceptance evidence section from AC checklist items. */
function buildAcceptanceEvidence(body: string): string {
  const checkboxRe = /^[ \t]*-[ \t]\[[ xX]\][ \t]+(.+)$/gm
  const items: string[] = []
  let m: RegExpExecArray | null
  while ((m = checkboxRe.exec(body)) !== null) {
    const captured = m[1]
    if (captured !== undefined) items.push(captured.trim())
  }

  if (items.length === 0) {
    return '<!-- No acceptance-criteria checklist found — add evidence manually -->'
  }

  return items
    .map((item) => `- [ ] ${item} — _add evidence: test name / log line / command output_`)
    .join('\n')
}

export async function finishCommand(issueNumber: number, opts: FinishOptions = {}): Promise<void> {
  const branch = currentBranch()

  if (isProtectedBranch(branch)) {
    throw new CliError(`You are on "${branch}". Run finish from a feature branch.`)
  }

  // 1. Fetch issue for metadata
  console.log(`\nFetching issue #${issueNumber}...`)
  const issue = fetchIssue(issueNumber)
  console.log(`  Title: ${issue.title}`)

  const labels = labelNames(issue)
  if (!labels.includes('status:in-progress')) {
    throw new CliError(
      `Issue #${issueNumber} is not labeled status:in-progress. Run "wivwav start ${issueNumber}" first.`,
    )
  }

  if (!hasAcceptanceCriteria(issue.body)) {
    throw new CliError(
      `Issue #${issueNumber} has no acceptance criteria. Cannot finish without AC to verify against.`,
    )
  }

  // 2. Fetch origin/main and rebase to ensure the branch is up-to-date
  if (!opts.skipValidation) {
    console.log('\nFetching origin/main...')
    const fetchResult = tryRun('git fetch origin main')
    if (!fetchResult.ok) {
      console.warn('[WARN] Could not fetch origin/main. Continuing without fetch.')
    }

    if (isBehindOriginMain()) {
      console.log('  Branch is behind origin/main — rebasing...')
      const rebaseResult = tryRun('git rebase origin/main')
      if (!rebaseResult.ok) {
        console.error('\nRebase failed:')
        console.error(rebaseResult.stdout)
        throw new CliError(
          'Cannot finish: rebase against origin/main failed. Resolve conflicts and re-run finish.',
        )
      }
      console.log('[OK] Rebased onto latest origin/main.')
    } else {
      console.log('[OK] Branch is up-to-date with origin/main.')
    }
  }

  // 3. Full validation
  if (!opts.skipValidation) {
    console.log('\nRunning full validation suite (typecheck + lint + build + test)...')
    const { stdout, ok } = tryRun('pnpm typecheck && pnpm lint && pnpm build && pnpm test')
    if (!ok) {
      console.error('\nValidation failed:')
      console.error(stdout)
      throw new CliError('Cannot finish: validation suite did not pass.')
    }
    console.log('[OK] Full validation passed.')
  }

  // 4. Check work exists: either staged files or commits already made during work
  const ahead = commitsAheadOfMain()
  const staged = stagedFiles()
  const hasWork = ahead > 0 || staged.length > 0

  if (!hasWork) {
    throw new CliError(
      'Nothing to finish: no commits ahead of origin/main and no staged files. ' +
      'Stage the files for this issue with `git add <files>` then re-run finish.',
    )
  }

  if (staged.length > 0) {
    const dirty = dirtyFiles()
    const unstaged = dirty.filter((f) => !staged.includes(f))
    if (unstaged.length > 0) {
      console.error('\n[ERROR] Untracked or unstaged files detected:')
      for (const f of unstaged) {
        console.error(`  ${f}`)
      }
      throw new CliError(
        'Cannot finish: stage only files relevant to this issue, or stash unrelated changes.',
      )
    }
  }

  // 5. Derive commit message components (used for commit and PR title)
  const commitType = opts.commitType ?? expectedPrefix(issue.title)
  const changed = changedFiles()
  const commitScope = opts.commitScope ?? deriveScope(changed)
  const description = opts.description ?? titleToDescription(issue.title)
  const closesIssue = opts.fixes !== false
  const issueRef = closesIssue ? `fixes #${issueNumber}` : `refs #${issueNumber}`
  const commitMsg = `${commitType}(${commitScope}): ${description} (${issueRef})`

  // Build trailers
  const trailers: string[] = []
  if (opts.agentRole) {
    trailers.push(`Agent-Role: ${opts.agentRole}`)
  }
  if (opts.agentIndex !== undefined) {
    trailers.push(`Agent-Index: ${opts.agentIndex}`)
  }
  if (opts.sprintRun) {
    trailers.push(`Sprint-Run: ${opts.sprintRun}`)
  }
  const coAuthor =
    opts.coAuthoredBy ?? process.env.WIVWAV_CO_AUTHOR ?? 'Claude Sonnet 4.6 <noreply@anthropic.com>'
  trailers.push(`Co-Authored-By: ${coAuthor}`)

  if (opts.dryRun) {
    console.log('\n[dry-run] Would perform:')
    if (staged.length > 0) {
      console.log(`  git commit -m "${commitMsg}" \\`)
      for (const t of trailers) {
        console.log(`    --trailer "${t}" \\`)
      }
    } else {
      console.log(`  (${ahead} commit(s) already made — skipping commit step)`)
    }
    console.log(`  git push -u origin ${branch}`)
    console.log(`  gh pr create --draft --title "..." --body "..." (or update existing PR body)`)
    return
  }

  // 6. Commit staged files if any; otherwise the worker already committed incrementally
  if (staged.length > 0) {
    console.log(`\nCommitting: ${commitMsg}`)
    const trailerArgs = trailers.map((t) => `--trailer ${JSON.stringify(t)}`).join(' ')
    run(`git commit -m ${JSON.stringify(commitMsg)} ${trailerArgs}`)
  } else {
    console.log(`\n${ahead} commit(s) already made — skipping commit step.`)
  }

  // 7. Push
  console.log(`\nPushing branch ${branch}...`)
  run(`git push -u origin ${branch}`)

  // 8. Build PR body
  const acceptanceEvidence = buildAcceptanceEvidence(issue.body)
  const prBody = [
    '## Summary',
    description,
    '',
    closesIssue ? `Closes #${issueNumber}` : `Refs #${issueNumber}`,
    '',
    '## Acceptance Evidence',
    acceptanceEvidence,
    '',
    '## Risk level',
    '- [x] Low / [ ] Medium / [ ] High',
    '',
    '## QA Notes',
    '_What a human reviewer should manually verify before approving._',
  ].join('\n')

  // 9. Open draft PR if none exists, otherwise update the existing PR body
  const prTitle = `${commitType}(${commitScope}): ${description}`
  const existingPrUrl = findExistingPr()
  let prUrl: string

  if (existingPrUrl !== null) {
    console.log(`\nDraft PR already open: ${existingPrUrl} — updating body with acceptance evidence...`)
    updatePrBody(prBody)
    prUrl = existingPrUrl
  } else {
    console.log('\nOpening draft PR...')
    prUrl = createDraftPr({ title: prTitle, body: prBody })
  }

  editIssueLabels(issueNumber, {
    add: ['status:needs-review'],
    remove: ['status:in-progress'],
  })

  console.log(`\nDraft PR is open: ${prUrl}`)
  console.log(
    'Issue labeled status:needs-review. Review the draft PR on GitHub and mark it ready when satisfied.',
  )
}
