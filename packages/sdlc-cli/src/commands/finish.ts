/**
 * wivwav finish <issue-number>
 *
 * Encodes the "Finish an issue" section of AGENTS.md:
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
  isDirty,
  stagedFiles,
  changedFiles,
  dirtyFiles,
} from '../lib/git.js'
import {
  fetchIssue,
  createDraftPr,
  hasAcceptanceCriteria,
  labelNames,
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

  // 2. Full validation
  if (!opts.skipValidation) {
    console.log('\nRunning full validation suite (typecheck + lint + test)...')
    const { stdout, ok } = tryRun('pnpm typecheck && pnpm lint && pnpm test')
    if (!ok) {
      console.error('\nValidation failed:')
      console.error(stdout)
      throw new CliError('Cannot finish: validation suite did not pass.')
    }
    console.log('[OK] Full validation passed.')
  }

  // 3. Check for unstaged or untracked files
  if (isDirty()) {
    const staged = stagedFiles()
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

  // 4. Derive commit message components
  const commitType = opts.commitType ?? 'feat'
  const changed = changedFiles()
  const commitScope = opts.commitScope ?? deriveScope(changed)
  const description = opts.description ?? titleToDescription(issue.title)
  const issueRef = opts.fixes !== false ? `fixes #${issueNumber}` : `refs #${issueNumber}`
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
    console.log(`  git commit -m "${commitMsg}" \\`)
    for (const t of trailers) {
      console.log(`    --trailer "${t}" \\`)
    }
    console.log(`  git push -u origin ${branch}`)
    console.log(`  gh pr create --draft --title "${commitMsg}" --body "..."`)
    return
  }

  // 5. Commit
  console.log(`\nCommitting: ${commitMsg}`)
  const trailerArgs = trailers.map((t) => `--trailer ${JSON.stringify(t)}`).join(' ')
  run(`git commit -m ${JSON.stringify(commitMsg)} ${trailerArgs}`)

  // 6. Push
  console.log(`\nPushing branch ${branch}...`)
  run(`git push -u origin ${branch}`)

  // 7. Build PR body
  const acceptanceEvidence = buildAcceptanceEvidence(issue.body)
  const prBody = [
    '## Summary',
    description,
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

  // 8. Open draft PR
  console.log('\nOpening draft PR...')
  const prTitle = `${commitType}(${commitScope}): ${description}`
  const prUrl = createDraftPr({ title: prTitle, body: prBody })

  console.log(`\nDraft PR is open: ${prUrl}`)
  console.log(
    'Run `/wivwav-code-review` (Claude Code) or manually review the diff before marking ready for merge.',
  )
}
