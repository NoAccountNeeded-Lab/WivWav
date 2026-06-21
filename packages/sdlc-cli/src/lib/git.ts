import { execSync } from 'node:child_process'

/** Run a shell command and return stdout, or throw with stderr on failure. */
export function run(cmd: string, opts?: { cwd?: string }): string {
  return execSync(cmd, { encoding: 'utf8', cwd: opts?.cwd }).trim()
}

/** Run a shell command and return stdout + exit code (never throws). */
export function tryRun(cmd: string, opts?: { cwd?: string }): { stdout: string; ok: boolean } {
  try {
    const stdout = run(cmd, opts)
    return { stdout, ok: true }
  } catch (err: unknown) {
    type SpawnErr = NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string }
    const e = err instanceof Error ? (err as SpawnErr) : null
    const out = e ? String(e.stdout ?? '') : ''
    const errOut = e ? String(e.stderr ?? '') : ''
    const combined = [out, errOut].filter(Boolean).join('\n')
    return { stdout: combined.trim(), ok: false }
  }
}

/** Return the current branch name. */
export function currentBranch(): string {
  return run('git rev-parse --abbrev-ref HEAD')
}

/** Return true when the working tree has uncommitted changes. */
export function isDirty(): boolean {
  return run('git status --porcelain') !== ''
}

/** Return true when the current branch exists on origin. */
export function existsOnRemote(branch: string): boolean {
  const { ok } = tryRun(`git ls-remote --exit-code --heads origin ${branch}`)
  return ok
}

/** Files changed vs. origin/main (new, modified, renamed, deleted). */
export function changedFiles(): string[] {
  const out = tryRun('git diff origin/main --name-only')
  if (!out.ok || out.stdout === '') return []
  return out.stdout.split('\n').filter(Boolean)
}

/** Files currently staged for commit. */
export function stagedFiles(): string[] {
  const out = tryRun('git diff --cached --name-only')
  if (!out.ok || out.stdout === '') return []
  return out.stdout.split('\n').filter(Boolean)
}

/** Files with any uncommitted status, including untracked files. */
export function dirtyFiles(): string[] {
  const out = tryRun('git status --porcelain')
  if (!out.ok || out.stdout === '') return []
  return out.stdout
    .split('\n')
    .map((line) => line.slice(3).split(' -> ').at(-1)?.trim() ?? '')
    .filter(Boolean)
}

/** Return true when on a protected branch (main or master). */
export function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master'
}

/** Derive the expected branch prefix from an issue type keyword. */
export function expectedPrefix(issueTitle: string): 'feat' | 'fix' | 'docs' | 'chore' {
  const lower = issueTitle.toLowerCase()
  if (lower.startsWith('fix') || lower.startsWith('bug')) return 'fix'
  if (lower.startsWith('doc')) return 'docs'
  if (lower.startsWith('chore') || lower.startsWith('refactor')) return 'chore'
  return 'feat'
}

/** Parse `N` from a branch name like `feat/issue-N-slug`. */
export function issueNumberFromBranch(branch: string): number | null {
  const match = /\/issue-(\d+)/i.exec(branch)
  return match?.[1] !== undefined ? parseInt(match[1], 10) : null
}

/**
 * Return true when origin/main has commits that the current branch does not
 * yet include (i.e. the branch is behind origin/main and needs a rebase).
 *
 * Uses `git rev-list --count HEAD..origin/main`; a count > 0 means behind.
 * Returns false on any git error (e.g. no remote access) so callers can
 * decide how to handle the degraded case.
 */
export function isBehindOriginMain(): boolean {
  const { stdout, ok } = tryRun('git rev-list --count HEAD..origin/main')
  if (!ok) return false
  return parseInt(stdout.trim(), 10) > 0
}
