import { type IssueData, hasAcceptanceCriteria, labelNames } from './github.js'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Validate that an issue is safe to start working on. */
export function validateIssueForStart(issue: IssueData): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (issue.state !== 'OPEN') {
    errors.push(`Issue #${issue.number} is not open (state: ${issue.state}).`)
  }

  const labels = labelNames(issue)
  if (labels.includes('status:in-progress')) {
    errors.push(
      `Issue #${issue.number} is already labeled status:in-progress. Is someone else working on it?`,
    )
  }

  if (!hasAcceptanceCriteria(issue.body)) {
    errors.push(
      `Issue #${issue.number} has no acceptance criteria. Add "Acceptance Criteria", "Done when", or a - [ ] checklist before starting.`,
    )
  }

  if (!labels.includes('status:ready') && !labels.includes('status:in-progress')) {
    warnings.push(
      `Issue #${issue.number} is not labeled status:ready. Verify it is intended for implementation.`,
    )
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Validate that a branch name conforms to the naming convention. */
export function validateBranchName(
  branch: string,
  issueNumber: number,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const validPrefixes = ['feat/', 'fix/', 'docs/', 'chore/']
  const hasValidPrefix = validPrefixes.some((p) => branch.startsWith(p))

  if (!hasValidPrefix) {
    errors.push(
      `Branch "${branch}" must start with one of: ${validPrefixes.join(', ')}.`,
    )
  }

  const issuePattern = new RegExp(`/issue-${issueNumber}(-|$)`)
  if (!issuePattern.test(branch)) {
    errors.push(
      `Branch "${branch}" must include "/issue-${issueNumber}-" followed by a short slug.`,
    )
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Merge multiple ValidationResults into one. */
export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap((r) => r.errors)
  const warnings = results.flatMap((r) => r.warnings)
  return { ok: errors.length === 0, errors, warnings }
}

/** Format a ValidationResult for human-readable terminal output. */
export function formatResult(result: ValidationResult): string {
  const lines: string[] = []
  for (const e of result.errors) {
    lines.push(`  [ERROR]   ${e}`)
  }
  for (const w of result.warnings) {
    lines.push(`  [WARNING] ${w}`)
  }
  return lines.join('\n')
}
