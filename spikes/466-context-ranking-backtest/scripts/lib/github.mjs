// github.mjs — thin `gh` CLI wrappers used by extract-corpus.mjs.
import { execFileSync } from 'node:child_process'

function ghJson(args) {
  const out = execFileSync('gh', args, { maxBuffer: 1024 * 1024 * 64, encoding: 'utf8' })
  return JSON.parse(out)
}

export function repoNameWithOwner() {
  return ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner
}

/** List merged PRs, newest first, up to `limit`. */
export function listMergedPrs(limit) {
  return ghJson([
    'pr',
    'list',
    '--state',
    'merged',
    '--limit',
    String(limit),
    '--json',
    'number,title,body,mergedAt,baseRefName',
  ])
}

const CLOSING_KEYWORD_RE =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi

/** Extract linked issue numbers from a PR body via closing keywords. */
export function linkedIssueNumbers(body) {
  const numbers = new Set()
  for (const match of (body ?? '').matchAll(CLOSING_KEYWORD_RE)) {
    numbers.add(Number(match[2]))
  }
  return [...numbers]
}

export function prDetail(repo, number) {
  return ghJson(['api', `repos/${repo}/pulls/${number}`])
}

export function prFiles(repo, number) {
  // paginate: PRs can have >30 files (100 per page, cap well above the
  // corpus's stated max of 73 changed files in a single PR)
  return ghJson(['api', `repos/${repo}/pulls/${number}/files`, '--paginate', '--slurp']).flat()
}

export function issueTimeline(repo, number) {
  try {
    return ghJson(['api', `repos/${repo}/issues/${number}/timeline`, '--paginate', '--slurp']).flat()
  } catch {
    return []
  }
}

export function issue(repo, number) {
  try {
    return ghJson(['api', `repos/${repo}/issues/${number}`])
  } catch {
    return null
  }
}
