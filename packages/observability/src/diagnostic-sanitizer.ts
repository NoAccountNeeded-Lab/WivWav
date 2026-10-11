import { scrubPii } from './sentry-pii.js'

/**
 * Defense-in-depth sanitizer for diagnostic gateway responses (#776). It does
 * NOT make source telemetry safe; ingestion-time redaction remains the first
 * line of defense. Returns a sanitized deep copy and never mutates its input.
 *
 * Every regex below is linear-time: no nested/unbounded quantifiers over
 * overlapping classes, and every repeat is length-bounded (ReDoS-safe).
 */

const REDACTED = '[REDACTED]'
const UNREADABLE = '[UNREADABLE]'
export const MAX_DEPTH = 32
/** Total values (objects AND primitives) visited per call. */
export const MAX_NODES = 20_000
/** Per-string cap; longer strings are truncated before scanning. */
export const MAX_STRING = 65_536
/** Total string characters kept per call. */
export const MAX_CHARS = 1_000_000

/** Normalized (lowercase, alphanumeric only) key substrings that are always stripped. */
const DENY_SUBSTRINGS = [
  'authorization', 'cookie', 'password', 'passwd', 'passphrase', 'secret', 'token', 'credential',
  'apikey', 'accesskey', 'privatekey', 'encrypted', 'session', 'bearer', 'header', 'config',
  'email', 'phone', 'contact', 'ipaddr', 'clientip', 'remoteip', 'remoteaddr', 'userip',
  'forwardedfor', 'payload', 'jobdata', 'signature',
]
/** Short keys matched exactly (substring would over-match, e.g. "author"). Bare "key" is
 *  deliberately NOT denied (legit identifier field); apiKey/secretKey etc. match above. */
const DENY_EXACT = new Set(['auth', 'pwd', 'pass', 'pw', 'dsn', 'sig', 'ip', 'cert', 'jwt'])

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return DENY_EXACT.has(k) || DENY_SUBSTRINGS.some((s) => k.includes(s))
}

/** Percent-decodes a name (up to 3 layers). Returns null on a malformed escape: callers fail closed. */
function decodeName(raw: string): string | null {
  let n = raw
  for (let i = 0; i < 3; i += 1) {
    try {
      const d = decodeURIComponent(n)
      if (d === n) return n
      n = d
    } catch {
      return null
    }
  }
  return n
}

/** One classifier for object keys and `name=value` / `name: value` assignments in strings. */
function isSensitiveName(raw: string): boolean {
  const d = decodeName(raw)
  return d === null || isSensitiveKey(d)
}

const isLineName = (raw: string) => /cookie|authorization/i.test(decodeName(raw) ?? 'cookie')

// ---- linear value scanners: each returns the index just past the value; unterminated => end of string

/** Quoted value starting at `i` (quote char), backslash-escape aware. */
function quotedEnd(s: string, i: number): number {
  const q = s[i]
  for (let j = i + 1; j < s.length; j += 1) {
    const c = s[j]
    if (c === '\\') j += 1
    else if (c === q) return j + 1
  }
  return s.length
}

/** Balanced {...}/[...] starting at `i`, string- and escape-aware. */
function balancedEnd(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j += 1) {
    const c = s[j]
    if (c === '"') j = quotedEnd(s, j) - 1
    else if (c === '{' || c === '[') depth += 1
    else if (c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) return j + 1
    }
  }
  return s.length
}

function valueEnd(s: string, i: number, toEol: boolean): number {
  const c = s[i]
  if (c === undefined) return i
  if (c === '"' || c === "'") return quotedEnd(s, i)
  if (c === '{' || c === '[') return balancedEnd(s, i)
  if (c === '\\') return s.length // escaped-quote JSON-in-string: cannot parse reliably, fail closed
  let j = i
  while (j < s.length) {
    const d = s[j] as string
    if (toEol ? d === '\n' || d === '\r' : /[\s"',;&]/.test(d)) break
    j += 1
  }
  return j
}

const ASSIGN_RE = /(?<![A-Za-z0-9_.%+-])([A-Za-z0-9_.%+-]+)(\\*["']?)[ \t]*([=:])[ \t]*/g

/** Redacts the value of every assignment whose name is sensitive (any value shape). */
function redactAssignments(s: string): string {
  let out = ''
  let last = 0
  ASSIGN_RE.lastIndex = 0
  for (let m = ASSIGN_RE.exec(s); m !== null; m = ASSIGN_RE.exec(s)) {
    const name = m[1] as string
    if (!isSensitiveName(name)) continue
    const start = m.index + m[0].length
    const end = valueEnd(s, start, isLineName(name))
    if (end <= start) continue
    out += s.slice(last, start) + REDACTED
    last = end
    ASSIGN_RE.lastIndex = end
  }
  return out + s.slice(last)
}

/** Fail closed: no length cap on the redacted span; every regex is a single linear scan. */
const STRING_RULES: readonly (readonly [RegExp, string])[] = [
  // scheme://userinfo@host (userinfo unbounded)
  [/\b([A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/)[^\s/@]*@/g, `$1${REDACTED}@`],
  // Bearer/Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, `$1 ${REDACTED}`],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // vendor key shapes: sk-..., ghp_..., AKIA..., xoxb-...
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  // email (lookbehind => each address run is scanned once; no quadratic restarts)
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[EMAIL]'],
  // international (+...) and NANP phones; plain digit runs and ISO dates don't match
  [/(?<![\w-])\+\d[\d\s().-]{6,}\d/g, '[PHONE]'],
  [/(?<![\w-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g, '[PHONE]'],
]

function applyStringRules(input: string): string {
  let s = redactAssignments(input)
  for (const [re, rep] of STRING_RULES) s = s.replace(re, rep)
  return scrubPii(s)
}

interface State {
  nodes: number
  chars: number
  ancestors: WeakSet<object>
}

const exhausted = (st: State) => st.nodes > MAX_NODES || st.chars > MAX_CHARS
const MAX_KEY = 256

function sanitizeText(input: string, depth: number, st: State): string {
  const s = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[TRUNCATED]` : input
  st.chars += s.length
  if (st.chars > MAX_CHARS) return '[TRUNCATED]'
  // A string that is wholly a JSON object/array is sanitized structurally.
  const c = s.trimStart()[0]
  if ((c === '{' || c === '[') && depth < MAX_DEPTH) {
    try {
      const parsed: unknown = JSON.parse(s)
      if (typeof parsed === 'object' && parsed !== null) return JSON.stringify(walk(parsed, depth + 1, st))
    } catch {
      /* not JSON: fall through to pattern rules */
    }
  }
  return applyStringRules(s)
}

export function sanitizeString(input: string): string {
  return sanitizeText(input, 0, { nodes: 0, chars: 0, ancestors: new WeakSet() })
}

function walk(value: unknown, depth: number, st: State): unknown {
  try {
    return walkInner(value, depth, st)
  } catch {
    return unreadable(st)
  }
}

function unreadable(st: State): string {
  st.nodes += 1
  st.chars += UNREADABLE.length
  return UNREADABLE
}

function walkInner(value: unknown, depth: number, st: State): unknown {
  if (++st.nodes > MAX_NODES || st.chars > MAX_CHARS) return '[TRUNCATED]'
  if (typeof value === 'string') return sanitizeText(value, depth, st)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return undefined // function, symbol: dropped
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (st.ancestors.has(value)) return '[CIRCULAR]'
  if (depth >= MAX_DEPTH) return '[TRUNCATED]'

  st.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = []
      const len = value.length
      for (let i = 0; i < len && !exhausted(st); i += 1) {
        let v: unknown
        try {
          v = walk(value[i], depth + 1, st) // getter runs only after the budget check
        } catch {
          v = unreadable(st)
        }
        out.push(v === undefined ? null : v)
      }
      return out
    }
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const keys = value instanceof Error ? ['name', 'message', 'stack'] : Object.keys(src)
    for (const k of keys) {
      if (exhausted(st)) break
      st.chars += k.length
      // deny/shape checks first: nothing is read (no getter runs) for dropped keys
      if (k.length > MAX_KEY || k === '__proto__' || isSensitiveKey(k)) continue
      // keys can carry data too (e.g. an email used as a map key): drop if any rule fires
      if (applyStringRules(k) !== k) continue
      let v: unknown
      try {
        v = walk(src[k], depth + 1, st)
      } catch {
        v = unreadable(st)
      }
      if (v !== undefined) out[k] = v
    }
    return out
  } finally {
    st.ancestors.delete(value)
  }
}

/** Recursive, non-mutating, deny-by-default sanitizer for diagnostic responses. */
export function sanitizeDiagnosticResponse<T>(value: T): T {
  return walk(value, 0, { nodes: 0, chars: 0, ancestors: new WeakSet() }) as T
}
