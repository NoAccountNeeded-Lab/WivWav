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

const WORDS = 'token|secret|key|passw(?:or)?d|passphrase|pwd|auth|sig|signature|credential|session|cookie|phone|mobile|email|contact'
const SECRET_NAME = `[A-Za-z0-9_.-]{0,40}(?:${WORDS})[A-Za-z0-9_.-]{0,40}`
const SECRET_WORD_RE = new RegExp(WORDS, 'i')

function decodeName(raw: string): string {
  let n = raw
  for (let i = 0; i < 3; i += 1) {
    try {
      const d = decodeURIComponent(n.replace(/\+/g, ' '))
      if (d === n) break
      n = d
    } catch {
      break
    }
  }
  return n
}

/** Applied in order. Fail closed: values are consumed to their natural end (no length cap on the
 *  redacted span), every regex is a single linear scan with no nested/overlapping quantifiers. */
const STRING_RULES: readonly (readonly [RegExp, string | ((...m: string[]) => string)])[] = [
  // whole-line credential headers (cookie lists, authorization schemes)
  [/\b((?:set-)?cookie|authorization|proxy-authorization)(["']?\s*[:=]\s*)[^\r\n]*/gi, `$1$2${REDACTED}`],
  // scheme://userinfo@host (userinfo unbounded)
  [/\b([A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/)[^\s/@]*@/g, `$1${REDACTED}@`],
  // query/form params: classify the percent-decoded name
  [
    /(^|[?&;\s])([^=&\s#"'?;]+)=(?!["'])([^&\s#"']*)/g,
    (m: string, pre: string, name: string) =>
      SECRET_WORD_RE.test(decodeName(name)) || isSensitiveKey(decodeName(name))
        ? `${pre}${name}=${REDACTED}`
        : m,
  ],
  // Bearer/Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, `$1 ${REDACTED}`],
  // name=value / name: value, quoted values consumed whole (unclosed quote runs to the end)
  [
    new RegExp(`\\b(${SECRET_NAME})(["']?\\s*[=:]\\s*)("[^"]*"?|'[^']*'?|[^\\s"',;&]*)`, 'gi'),
    `$1$2${REDACTED}`,
  ],
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
  let s = input
  for (const [re, rep] of STRING_RULES) s = s.replace(re, rep as string)
  return scrubPii(s)
}

interface State {
  nodes: number
  chars: number
  ancestors: WeakSet<object>
}

const exhausted = (st: State) => st.nodes > MAX_NODES || st.chars > MAX_CHARS

function sanitizeText(input: string, depth: number, st: State): string {
  let s = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[TRUNCATED]` : input
  st.chars += s.length
  if (st.chars > MAX_CHARS) return '[TRUNCATED]'
  // JSON embedded in a string (whole, or from the first brace/bracket): sanitize structurally
  const start = s.search(/[{[]/)
  if (start >= 0 && depth < MAX_DEPTH) {
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
    if (end > start) {
      try {
        const parsed: unknown = JSON.parse(s.slice(start, end + 1))
        if (typeof parsed === 'object' && parsed !== null) {
          const inner = JSON.stringify(walk(parsed, depth + 1, st))
          s = applyStringRules(s.slice(0, start)) + inner + applyStringRules(s.slice(end + 1))
          return s
        }
      } catch {
        /* not JSON: fall through to pattern rules */
      }
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
    return UNREADABLE
  }
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
        let raw: unknown
        try {
          raw = value[i]
        } catch {
          raw = UNREADABLE
        }
        const v = raw === UNREADABLE ? UNREADABLE : walk(raw, depth + 1, st)
        out.push(v === undefined ? null : v)
      }
      return out
    }
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const read = (k: string): unknown => {
      try {
        return src[k]
      } catch {
        return UNREADABLE
      }
    }
    const entries: [string, unknown][] =
      value instanceof Error
        ? [['name', read('name')], ['message', read('message')], ['stack', read('stack')]]
        : Object.keys(src).map((k) => [k, read(k)])
    for (const [k, raw] of entries) {
      if (exhausted(st)) break
      if (k === '__proto__' || isSensitiveKey(k)) continue
      // keys can carry data too (e.g. an email used as a map key): drop if any rule fires
      if (applyStringRules(k) !== k) continue
      const v = raw === UNREADABLE ? UNREADABLE : walk(raw, depth + 1, st)
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
