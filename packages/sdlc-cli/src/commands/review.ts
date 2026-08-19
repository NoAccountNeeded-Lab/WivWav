/**
 * wivwav review [issue-number]
 *
 * Encodes the "Review changed files" section of AGENTS.md:
 *   1. Identify changed files vs. origin/main
 *   2. Run affected-only validation (fast path) or full suite
 *   3. Produce a checklist-oriented review packet
 */
import { changedFiles, tryRun, currentBranch, isProtectedBranch } from '../lib/git.js'
import { fetchIssue, hasAcceptanceCriteria, CliError } from '../lib/github.js'

export interface ReviewOptions {
  full?: boolean
  issueNumber?: number
}

interface ReviewPacket {
  branch: string
  changedFiles: string[]
  checksOk: boolean
  checkOutput: string
  acItems: string[]
  notes: string[]
}

/** Extract acceptance-criteria checklist items from the issue body. */
function extractAcItems(body: string | null): string[] {
  if (!body) return []

  // Match markdown task list items: `- [ ] text` or `- [x] text`
  const checkboxRe = /^[ \t]*-[ \t]\[[ xX]\][ \t]+(.+)$/gm
  const items: string[] = []
  let m: RegExpExecArray | null
  while ((m = checkboxRe.exec(body)) !== null) {
    const captured = m[1]
    if (captured !== undefined) items.push(captured.trim())
  }

  // If no checkbox items, try "Done when" or "Acceptance Criteria" bullet lists
  if (items.length === 0) {
    const acSection =
      /(?:acceptance criteria|done when)[:\s]*([\s\S]*?)(?:\n#|\n---|\n\n[A-Z]|$)/i.exec(body)
    if (acSection) {
      const sectionBody = acSection[1] ?? ''
      const bullets = sectionBody.match(/^[ \t]*[-*][ \t]+(.+)$/gm) ?? []
      for (const b of bullets) {
        items.push(b.replace(/^[ \t]*[-*][ \t]+/u, '').trim())
      }
    }
  }

  return items
}

/** Domain-specific notes based on which files changed. */
function buildDomainNotes(files: string[]): string[] {
  const notes: string[] = []

  if (files.some((f) => f.startsWith('apps/web/'))) {
    notes.push(
      '[web] WCAG 2.1 AA: verify keyboard navigation, ARIA roles, color contrast, mobile touch targets (44×44 px).',
    )
  }
  if (files.some((f) => f.startsWith('apps/api/src/routes/'))) {
    notes.push('[api] Verify docs/api-routes.md is current after route changes.')
  }
  if (files.some((f) => f.startsWith('packages/scraper-sources/'))) {
    notes.push(
      '[scraper-sources] Avoid arrow functions inside page.evaluate() — tsx esbuild wraps them with __name() which breaks in Playwright browser context. Use function declarations instead.',
    )
  }
  if (files.some((f) => f.includes('.env') || f.includes('secrets'))) {
    notes.push(
      '[security] Detected possible secrets file in diff. Do NOT commit .env or credentials files.',
    )
  }

  return notes
}

export async function reviewCommand(opts: ReviewOptions = {}): Promise<void> {
  const branch = currentBranch()

  if (isProtectedBranch(branch)) {
    throw new CliError(`You are on "${branch}". Run review from a feature branch.`)
  }

  // Gather changed files
  const files = changedFiles()
  if (files.length === 0) {
    console.log('\nNo files changed vs. origin/main. Nothing to review.')
    return
  }

  console.log(`\nChanged files vs. origin/main (${files.length}):`)
  for (const f of files) {
    console.log(`  ${f}`)
  }

  // Determine which validation to run
  const useFullSuite = opts.full ?? false
  const checkCmd = useFullSuite
    ? 'pnpm typecheck && pnpm lint && pnpm build && pnpm test'
    : 'pnpm check:affected'

  console.log(`\nRunning ${useFullSuite ? 'full' : 'affected'} validation suite...`)
  console.log(`  $ ${checkCmd}`)

  const { stdout: checkOutput, ok: checksOk } = tryRun(checkCmd)

  if (!checksOk) {
    console.error('\n[ERROR] Validation suite failed. Fix all errors before continuing.')
    console.error(checkOutput)
  } else {
    console.log('\n[OK] All checks passed.')
  }

  // Domain-specific notes
  const notes = buildDomainNotes(files)

  // Optionally load AC items from the issue
  let acItems: string[] = []
  if (opts.issueNumber) {
    try {
      const issue = fetchIssue(opts.issueNumber)
      if (hasAcceptanceCriteria(issue.body)) {
        acItems = extractAcItems(issue.body)
      } else {
        console.warn(`\n[WARNING] Issue #${opts.issueNumber} has no acceptance criteria.`)
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? ` ${err.message}` : ''
      throw new CliError(`Could not fetch issue #${opts.issueNumber} for AC check.${detail}`)
    }
  }

  // Print review packet
  const packet: ReviewPacket = {
    branch,
    changedFiles: files,
    checksOk,
    checkOutput,
    acItems,
    notes,
  }
  printReviewPacket(packet)

  if (!checksOk) {
    throw new CliError('Review failed: validation suite did not pass.')
  }
}

function printReviewPacket(p: ReviewPacket): void {
  console.log('\n' + '='.repeat(60))
  console.log('SDLC REVIEW PACKET')
  console.log('='.repeat(60))
  console.log(`Branch:  ${p.branch}`)
  console.log(`Checks:  ${p.checksOk ? 'PASSED' : 'FAILED'}`)

  console.log('\n## Changed Files')
  for (const f of p.changedFiles) {
    console.log(`  - ${f}`)
  }

  if (p.notes.length > 0) {
    console.log('\n## Domain Notes')
    for (const n of p.notes) {
      console.log(`  ${n}`)
    }
  }

  if (p.acItems.length > 0) {
    console.log('\n## Acceptance Criteria Checklist')
    console.log('  (verify each item is provably implemented in the diff)')
    for (const item of p.acItems) {
      console.log(`  - [ ] ${item}`)
    }
  }

  console.log('\n## Review Dimensions')
  const dimensions = [
    'Type safety — null checks, incorrect type assumptions, unsafe casts',
    'Security — input validation at system boundaries, injection risks, exposed secrets',
    'Logic bugs — missed edge cases, wrong conditionals, off-by-one errors',
    'Acceptance criteria — every AC item must be provably implemented',
  ]
  for (const d of dimensions) {
    console.log(`  - [ ] ${d}`)
  }

  console.log('\n## Findings')
  console.log('  Label each finding: [CRITICAL] / [WARNING] / [SUGGESTION]')
  console.log('  Fix all [CRITICAL] and [WARNING] before finishing.')
  console.log('  Write missing Vitest tests for any changed logic that lacks coverage.')
  console.log('='.repeat(60))
}
