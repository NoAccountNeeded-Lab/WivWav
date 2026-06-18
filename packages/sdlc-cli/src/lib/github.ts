import { run, tryRun } from './git.js'

export interface IssueData {
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ name: string }>
}

export interface IssueSummary {
  number: number
  title: string
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

/** List ready issues from GitHub, sorted by issue number ascending. */
export function listReadyIssues(limit = 20): IssueSummary[] {
  ensureGhAuth()
  const json = run(`gh issue list --label status:ready --json number,title --limit ${limit}`)
  const issues = JSON.parse(json) as IssueSummary[]
  return issues.sort((a, b) => a.number - b.number)
}

/** Add and remove labels on a GitHub issue. */
export function editIssueLabels(
  issueNumber: number,
  opts: { add?: string[]; remove?: string[] },
): void {
  const addArgs = (opts.add ?? []).map((l) => `--add-label ${shellQuote(l)}`).join(' ')
  const removeArgs = (opts.remove ?? []).map((l) => `--remove-label ${shellQuote(l)}`).join(' ')
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
  return extractAcceptanceCriteria(body).length > 0
}

/** Extract reusable acceptance criteria lines from an issue body. */
export function extractAcceptanceCriteria(body: string): string[] {
  if (!body || body.trim() === '') return []

  const checklistItems = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-[ \t]\[[ xX]\][ \t]+\S/.test(line))

  if (checklistItems.length > 0) return checklistItems

  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) =>
    /(^#{1,6}[ \t]+(?:acceptance criteria|ac)\b|acceptance criteria|^done when\b)/i.test(
      line.trim(),
    ),
  )
  if (start === -1) return []

  const criteria: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}[ \t]+\S/.test(line.trim())) break
    if (line.trim() !== '') criteria.push(line.trim())
  }

  if (criteria.length === 0) return [lines[start]?.trim() ?? ''].filter((line) => line !== '')

  return criteria
}

/** Structured error for CLI user-facing failures. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}
