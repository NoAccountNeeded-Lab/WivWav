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
export const MAX_DEPTH = 32
export const MAX_NODES = 20_000
export const MAX_STRING = 65_536

/** Normalized (lowercase, alphanumeric only) key substrings that are always stripped. */
const DENY_SUBSTRINGS = [
  'authorization', 'cookie', 'password', 'passwd', 'secret', 'token', 'credential',
  'apikey', 'privatekey', 'encrypted', 'session', 'bearer', 'header', 'config',
  'email', 'phone', 'contact', 'ipaddress', 'payload', 'jobdata', 'signature',
]
/** Short keys matched exactly (substring would over-match, e.g. "author"). */
const DENY_EXACT = new Set(['auth', 'pwd', 'dsn', 'key', 'sig', 'ip', 'cert', 'jwt'])

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return DENY_EXACT.has(k) || DENY_SUBSTRINGS.some((s) => k.includes(s))
}

const SECRET_NAME = '[A-Za-z0-9_.-]{0,40}(?:token|secret|key|passw(?:or)?d|pwd|auth|sig|signature|credential|session|cookie)[A-Za-z0-9_.-]{0,40}'

/** Applied in order; each replacement keeps non-secret context (scheme, param name). */
const STRING_RULES: readonly (readonly [RegExp, string])[] = [
  // scheme://user:pass@host
  [/\b([A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/)[^\s/@]{1,256}@/g, `$1${REDACTED}@`],
  // ?token=..., &api_key=...
  [new RegExp(`([?&;])(${SECRET_NAME})=[^&\\s#"']{0,2048}`, 'gi'), `$1$2=${REDACTED}`],
  // Bearer/Basic credentials
  [/\b(Bearer|Basic)\s{1,4}[A-Za-z0-9._~+/=-]{8,2048}/gi, `$1 ${REDACTED}`],
  // name=value / name: value in free text and log lines (also JSON-ish "name":"value")
  [new RegExp(`\\b(${SECRET_NAME})(["']?\\s{0,3}[=:]\\s{0,3}["']?)[^\\s"',;&]{1,2048}`, 'gi'), `$1$2${REDACTED}`],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{0,2048}/g, REDACTED],
  // vendor key shapes: sk-..., ghp_..., AKIA..., xoxb-...
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,256}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,255}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,256}/g, REDACTED],
  // email
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}/g, '[EMAIL]'],
  // phone (NANP-ish / international with separators; plain digit runs and ISO dates don't match)
  [/(?<![\w-])\+?\d{0,3}[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g, '[PHONE]'],
]

export function sanitizeString(input: string): string {
  let s = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[TRUNCATED]` : input
  for (const [re, rep] of STRING_RULES) s = s.replace(re, rep)
  return scrubPii(s)
}

interface State {
  nodes: number
  ancestors: WeakSet<object>
}

function walk(value: unknown, depth: number, st: State): unknown {
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null || value === undefined) return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return undefined // function, symbol: dropped
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (st.ancestors.has(value)) return '[CIRCULAR]'
  if (depth >= MAX_DEPTH) return '[TRUNCATED]'
  if (++st.nodes > MAX_NODES) return '[TRUNCATED]'

  st.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = []
      for (let i = 0; i < value.length; i += 1) {
        const v = walk(value[i], depth + 1, st)
        out.push(v === undefined ? null : v)
        if (st.nodes > MAX_NODES) break
      }
      return out
    }
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const entries: [string, unknown][] =
      value instanceof Error
        ? [['name', value.name], ['message', value.message], ['stack', value.stack]]
        : Object.keys(src).map((k) => [k, undefined])
    for (const [k, preset] of entries) {
      if (k === '__proto__' || isSensitiveKey(k)) continue
      let raw: unknown
      try {
        raw = value instanceof Error ? preset : src[k]
      } catch {
        raw = '[UNREADABLE]'
      }
      const v = walk(raw, depth + 1, st)
      if (v !== undefined) out[k] = v
      if (st.nodes > MAX_NODES) break
    }
    return out
  } finally {
    st.ancestors.delete(value)
  }
}

/** Recursive, non-mutating, deny-by-default sanitizer for diagnostic responses. */
export function sanitizeDiagnosticResponse<T>(value: T): T {
  return walk(value, 0, { nodes: 0, ancestors: new WeakSet() }) as T
}
