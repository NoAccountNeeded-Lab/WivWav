// classify-path.mjs — versioned path-strata classifier for the #466 backtest.
//
// Given a repo-relative path, returns one of:
//   'source'    — implementation source, eligible for primary ranking/scoring
//   'test'      — test files (unit/integration/e2e)
//   'docs'      — Markdown/docs
//   'migration' — DB migrations / generated schema
//   'generated' — build artifacts, lockfiles, generated code
//   'other'     — everything else (config at repo root, etc.) — reported, never
//                 scored as a ranker miss
//
// CLASSIFIER_VERSION must be bumped whenever the rules below change, so the
// frozen corpus.json (which embeds this version) is auditable against the
// code that produced it.
export const CLASSIFIER_VERSION = 1

const TEST_RE = /(^|\/)(__tests__|__mocks__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const DOCS_RE = /(^|\/)docs\//i
const DOCS_FILE_RE = /\.(md|mdx)$/i
const MIGRATION_RE = /(^|\/)(prisma\/migrations|migrations)\//i
const GENERATED_RE =
  /(^|\/)(dist|build|\.next|coverage|node_modules|\.turbo)\//i
const LOCKFILE_RE = /^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i
const SOURCE_EXT_RE = /\.([cm]?[jt]sx?|prisma|sql)$/i

/**
 * @param {string} path repo-relative path (posix separators)
 * @returns {'source'|'test'|'docs'|'migration'|'generated'|'other'}
 */
export function classifyPath(path) {
  if (LOCKFILE_RE.test(path) || GENERATED_RE.test(path)) return 'generated'
  if (MIGRATION_RE.test(path)) return 'migration'
  if (DOCS_RE.test(path) || DOCS_FILE_RE.test(path)) return 'docs'
  if (TEST_RE.test(path)) return 'test'
  if (SOURCE_EXT_RE.test(path)) return 'source'
  return 'other'
}

/**
 * Classify a single PR file entry (as returned by
 * `gh api repos/{owner}/{repo}/pulls/{n}/files`) into a corpus-analysis
 * record. Renames and deletions score against `previous_filename`/`filename`
 * (the pre-change path); added files have no pre-change path and are
 * reported separately — never counted as a ranker miss.
 *
 * @param {{status: string, filename: string, previous_filename?: string}} file
 */
export function classifyPrFile(file) {
  const isAdded = file.status === 'added'
  const isRenamed = file.status === 'renamed'
  const isDeleted = file.status === 'removed'
  const preChangePath = isAdded ? null : isRenamed ? file.previous_filename : file.filename

  return {
    status: file.status,
    filename: file.filename,
    previousFilename: file.previous_filename ?? null,
    preChangePath,
    strata: preChangePath ? classifyPath(preChangePath) : classifyPath(file.filename),
    countsAsRankerTarget:
      preChangePath !== null && classifyPath(preChangePath) === 'source' && !isAdded,
  }
}
