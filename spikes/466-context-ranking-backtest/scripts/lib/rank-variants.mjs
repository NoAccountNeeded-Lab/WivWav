// rank-variants.mjs — the five ranking variants compared in Stage A.
//
// Every variant returns an array of {path, score} sorted best-first
// (ties broken by path for determinism). map-builder.mjs then walks this
// order to fill the 1,000-token budget identically for every variant.

const STOP_WORDS = new Set([
  'acceptance',
  'agent',
  'agents',
  'and',
  'body',
  'context',
  'criteria',
  'file',
  'files',
  'for',
  'from',
  'issue',
  'model',
  'prompt',
  'sprint',
  'that',
  'the',
  'this',
  'usage',
  'when',
  'with',
])

/** Byte-for-byte the algorithm in packages/sdlc-cli/src/commands/run-sprint.ts. */
export function keywordCandidates(title, body, labels = []) {
  const source = [title, body, ...labels].join(' ')
  return [...new Set(source.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 30)
}

function sortDeterministic(scored) {
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

/**
 * Reproduces run-sprint.ts's `likelyFileHints`: substring overlap between the
 * lowercased keyword set and the lowercased full path, scored across the
 * entire path string (not tokenized). This is today's production baseline.
 */
export function rankLikelyFileHints(paths, keywords) {
  const scored = paths.map((path) => {
    const normalized = path.toLowerCase()
    const score = keywords.reduce((sum, kw) => sum + (normalized.includes(kw) ? 1 : 0), 0)
    return { path, score }
  })
  return sortDeterministic(scored)
}

function pathTokens(path) {
  return path
    .toLowerCase()
    .split(/[/._-]+/)
    .filter(Boolean)
}

/**
 * Token-level keyword ranking: splits each path into path-segment tokens and
 * scores exact/prefix token matches against the issue keyword set. Distinct
 * from rankLikelyFileHints (whole-string substring match) — a token can
 * "vin" match "vinDecoder" via prefix without "in" spuriously matching
 * "listing" the way whole-string substring search would.
 */
export function rankIssueKeyword(paths, keywords) {
  const scored = paths.map((path) => {
    const tokens = pathTokens(path)
    let score = 0
    for (const token of tokens) {
      for (const kw of keywords) {
        if (token === kw || token.startsWith(kw) || kw.startsWith(token)) {
          score += 1
          break
        }
      }
    }
    return { path, score }
  })
  return sortDeterministic(scored)
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

function resolveRelative(fromPath, spec) {
  if (!spec.startsWith('.')) return null // skip package imports; repo-internal only
  const fromDir = fromPath.split('/').slice(0, -1)
  const parts = spec.split('/')
  const stack = [...fromDir]
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/**
 * Dependency centrality: static regex import scan across every file in the
 * snapshot, resolving relative imports to repo paths and counting in-degree
 * (how many other files import this one). Not a real module resolver —
 * extensionless/dir-index specifiers are matched by longest-prefix against
 * the actual file set. Package (non-relative) imports are ignored.
 */
export function rankDependencyCentrality(paths, contentByPath) {
  const pathSet = new Set(paths)
  const indegree = new Map(paths.map((p) => [p, 0]))

  const resolveToActual = (candidate) => {
    if (pathSet.has(candidate)) return candidate
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
      if (pathSet.has(candidate + ext)) return candidate + ext
    }
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
      if (pathSet.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`
    }
    return null
  }

  for (const path of paths) {
    const content = contentByPath.get(path)
    if (!content) continue
    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2]
      if (!spec) continue
      const resolved = resolveRelative(path, spec)
      if (!resolved) continue
      const actual = resolveToActual(resolved)
      if (actual && indegree.has(actual)) {
        indegree.set(actual, indegree.get(actual) + 1)
      }
    }
  }

  const scored = paths.map((path) => ({ path, score: indegree.get(path) ?? 0 }))
  return sortDeterministic(scored)
}

/** Weighted fusion of token-keyword rank and dependency centrality. */
export function rankCombined(keywordRanked, centralityRanked, weights = { keyword: 0.6, centrality: 0.4 }) {
  const maxKeyword = Math.max(1, ...keywordRanked.map((r) => r.score))
  const maxCentrality = Math.max(1, ...centralityRanked.map((r) => r.score))
  const centralityByPath = new Map(centralityRanked.map((r) => [r.path, r.score]))

  const scored = keywordRanked.map(({ path, score }) => {
    const kwNorm = score / maxKeyword
    const centNorm = (centralityByPath.get(path) ?? 0) / maxCentrality
    return { path, score: weights.keyword * kwNorm + weights.centrality * centNorm }
  })
  return sortDeterministic(scored)
}

/** Deterministic seeded PRNG (mulberry32) shuffle — the random control. */
function mulberry32(seed) {
  let a = seed
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromNumber(n) {
  return (n * 2654435761) >>> 0
}

export function rankRandomControl(paths, seedNumber) {
  const rng = mulberry32(seedFromNumber(seedNumber))
  const withKeys = paths.map((path) => ({ path, key: rng() }))
  withKeys.sort((a, b) => a.key - b.key)
  return withKeys.map(({ path }, index) => ({ path, score: withKeys.length - index }))
}
