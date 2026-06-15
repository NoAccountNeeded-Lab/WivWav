import { run, tryRun } from './git.js'

export interface IssueData {
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ name: string }>
}

/** Fetch issue data from GitHub using the `gh` CLI. Throws if auth is missing. */
export function fetchIssue(issueNumber: number): IssueData {
  ensureGhAuth()
  const json = run(`gh issue view ${issueNumber} --json number,title,body,state,labels`)
  const raw = JSON.parse(json) as Omit<IssueData, 'body'> & {
    body: string | null
  }
  return { ...raw, body: raw.body ?? '' }
}

/** Add and remove labels on a GitHub issue. */
export function editIssueLabels(
  issueNumber: number,
  opts: { add?: string[]; remove?: string[] },
): void {
  const addArgs = (opts.add ?? []).map((l) => `--add-label "${l}"`).join(' ')
  const removeArgs = (opts.remove ?? []).map((l) => `--remove-label "${l}"`).join(' ')
  run(`gh issue edit ${issueNumber} ${addArgs} ${removeArgs}`.trim())
}

/** Post a comment on a GitHub issue. */
export function postComment(issueNumber: number, body: string): void {
  run(`gh issue comment ${issueNumber} --body ${shellQuote(body)}`)
}

/** Create a draft PR and return its URL. */
export function createDraftPr(opts: { title: string; body: string }): string {
  const result = run(
    `gh pr create --draft --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}`,
  )
  // gh pr create outputs "https://github.com/..." on success
  return result.trim()
}

/** Return true when `gh auth status` exits 0. */
export function isGhAuthenticated(): boolean {
  return tryRun('gh auth status').ok
}

/** Throw a user-friendly error when GitHub auth is unavailable. */
export function ensureGhAuth(): void {
  if (!isGhAuthenticated()) {
    throw new CliError('GitHub CLI is not authenticated. Run `gh auth login` first.')
  }
}

/** Minimally escape a string for single-use in a shell argument. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Extract label names from an IssueData object. */
export function labelNames(issue: IssueData): string[] {
  return issue.labels.map((l) => l.name)
}

/** Detect acceptance criteria in an issue body. */
export function hasAcceptanceCriteria(body: string): boolean {
  if (!body || body.trim() === '') return false
  const lower = body.toLowerCase()
  return (
    lower.includes('acceptance criteria') || lower.includes('done when') || /- \[[ x]\]/.test(body)
  )
}

/** Structured error for CLI user-facing failures. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}
