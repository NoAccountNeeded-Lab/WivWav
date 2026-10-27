import { scrubPii } from './sentry-pii.js'

/**
 * Defense-in-depth sanitizer for diagnostic gateway responses (#776). It fails closed
 * (when unsure, it redacts or drops) but it is NOT a guarantee: it does not make source
 * telemetry safe, and ingestion-time redaction remains the first line of defense.
 * Returns a sanitized deep copy and never mutates its input.
 *
 * Objects: sensitive keys (percent-decoded, case/punctuation-insensitive) are dropped.
 * Free text, in order: (a) any line mentioning cookie/authorization is redacted whole;
 * (b) URLs keep scheme+host+path, userinfo and the whole query/fragment are redacted;
 * (c) balanced {...}/[...] fragments that parse as JSON are sanitized structurally;
 * (d) a sensitive name followed by =/: redacts the rest of its line, then the
 * Bearer/JWT/vendor-key/email/phone/VIN patterns run. Every regex is linear-time.
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
  for (let i = 0; i < 4; i += 1) {
    try {
      const d = decodeURIComponent(n)
      if (d === n) return n
      n = d
    } catch {
      return null
    }
  }
  return null // still changing after the decode limit: fail closed
}

/** One classifier for object keys and `name=value` / `name: value` assignments in strings. */
function isSensitiveName(raw: string): boolean {
  const d = decodeName(raw)
  return d === null || isSensitiveKey(d)
}

// ---- balanced-fragment scanner (used only for step (c))

/** Quoted string starting at `i` (the quote char), backslash-escape aware. Unterminated => s.length. */
function quotedEnd(s: string, i: number): number {
  const q = s[i]
  for (let j = i + 1; j < s.length; j += 1) {
    const c = s[j]
    if (c === '\\') j += 1
    else if (c === q) return j + 1
  }
  return s.length
}

/** Balanced {...}/[...] starting at `i`, aware of quoted strings. Returns the end index or -1. */
function balancedScan(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j += 1) {
    const c = s[j]
    if (c === '"' || c === "'") j = quotedEnd(s, j) - 1
    else if (c === '{' || c === '[') depth += 1
    else if (c === '}' || c === ']') {
      depth -= 1
      if (depth === 0) return j + 1
    }
  }
  return -1
}

// ---- free-text steps

const URL_RE = /\b([A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/)([^\s?#]*@)?([^\s/?#]*)([^\s?#]*)([?#]\S*)?/g

/** (a) cookie/authorization lines, (b) URLs. */
function redactLinesAndUrls(s: string): string {
  return s
    .split('\n')
    .map((line) =>
      /cookie|authorization/i.test(line)
        ? REDACTED
        : line.replace(URL_RE, (_m, scheme: string, ui: string | undefined, host: string, path: string, qf: string | undefined) =>
            `${scheme}${ui ? `${REDACTED}@` : ''}${host}${path}${qf ? `${qf[0]}${REDACTED}` : ''}`,
          ),
    )
    .join('\n')
}

/** A name (optionally two words, e.g. "api key"; optional [] suffix) directly before =/: */
const NAME_SEP_RE =
  /(?<![A-Za-z0-9_.%+-])((?:[A-Za-z0-9_.%+-]+[ \t]+)?[A-Za-z0-9_.%+-]+(?:\[[A-Za-z0-9_.-]{0,20}\])*)\\*["']?[ \t]*[=:]/g

const PATTERN_RULES: readonly (readonly [RegExp, string])[] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, `$1 ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  // email (lookbehind => each address run is scanned once; no quadratic restarts)
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[EMAIL]'],
  // international (+...) and NANP phones; plain digit runs and ISO dates don't match
  [/(?<![\w-])\+\d[\d\s().-]{6,}\d/g, '[PHONE]'],
  [/(?<![\w-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g, '[PHONE]'],
  // IPv4 (octet range not checked: fail closed, so dotted version strings like 1.2.3.4 are also redacted)
  [/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '[IP]'],
]

function isSensitivePhrase(phrase: string): boolean {
  const words = phrase.split(/[ \t]+/)
  return isSensitiveName(phrase.replace(/[ \t]+/g, '')) || words.some(isSensitiveName)
}

/** (d) sensitive name before =/: redacts the rest of the line; then the value-shape patterns. */
function redactNamesAndPatterns(input: string): string {
  let s = input
    .split('\n')
    .map((line) => {
      NAME_SEP_RE.lastIndex = 0
      for (let m = NAME_SEP_RE.exec(line); m !== null; m = NAME_SEP_RE.exec(line)) {
        if (isSensitivePhrase(m[1] as string)) return line.slice(0, m.index + m[0].length) + REDACTED
      }
      return line
    })
    .join('\n')
  for (const [re, rep] of PATTERN_RULES) s = s.replace(re, rep)
  return scrubPii(s)
}

const OPEN_RE = /[{[]/g

/** (c) Outermost balanced fragments that parse as JSON are sanitized structurally; others are left
 *  for step (d). Scan work is budgeted: on exhaustion the tail is dropped (fail closed). */
function sanitizeFragments(s: string, depth: number, st: State): string {
  if (depth >= MAX_DEPTH) return s
  let budget = 4 * s.length + 1024
  let out = ''
  let last = 0
  OPEN_RE.lastIndex = 0
  for (let m = OPEN_RE.exec(s); m !== null; m = OPEN_RE.exec(s)) {
    const i = m.index
    const end = balancedScan(s, i)
    budget -= end < 0 ? s.length - i : end - i
    if (budget < 0) return out + s.slice(last, i) + '[TRUNCATED]'
    if (end < 0) continue
    try {
      const rep = JSON.stringify(walk(JSON.parse(s.slice(i, end)) as unknown, depth + 1, st))
      out += s.slice(last, i) + rep
      last = end
      OPEN_RE.lastIndex = end
    } catch {
      OPEN_RE.lastIndex = end // not JSON: leave for step (d), do not descend
    }
  }
  return out + s.slice(last)
}

/** Key/standalone text check without structural parsing. */
const redactText = (s: string): string => redactNamesAndPatterns(redactLinesAndUrls(s))

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
  return redactNamesAndPatterns(sanitizeFragments(redactLinesAndUrls(s), depth, st))
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
      if (k.length > MAX_KEY || k === '__proto__' || isSensitiveName(k)) continue
      // keys can carry data too (e.g. an email used as a map key): drop if any rule fires
      if (redactText(k) !== k) continue
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
