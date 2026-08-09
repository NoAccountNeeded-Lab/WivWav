/**
 * Named, pure transforms available to declarative `FieldMapping.transform`
 * values (#822). This is a closed set — a mapping's `transform` string is
 * looked up here by name, never evaluated as code, so a compromised or
 * malformed `Source.mappings` row can only select among these fixed
 * functions, not execute arbitrary logic.
 *
 * Every transform is a pure `(raw: string) => string | number | null`
 * function over a single already-trimmed, non-empty text value. Returning
 * `null` signals "value present on the page but not parseable in the
 * expected shape" — distinct from the caller's own "no match" ('missing')
 * case, which never reaches a transform at all.
 */

export type FieldTransformName = 'trimText' | 'parsePrice' | 'parseInches'

export type FieldTransformResult = string | number | null

type FieldTransformFn = (raw: string) => FieldTransformResult

/** Collapses internal whitespace/newlines and trims — the identity transform for text fields. */
function trimText(raw: string): FieldTransformResult {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  return collapsed.length > 0 ? collapsed : null
}

/** Parses a dollar amount ("$70,000", "70000.50") into integer cents. */
function parsePrice(raw: string): FieldTransformResult {
  const digits = raw.replace(/[^0-9.]/g, '')
  if (digits.length === 0) return null
  const dollars = Number.parseFloat(digits)
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null
}

/** Parses a leading integer measurement ("33", "33 in.", "33\" wide") into inches. */
function parseInches(raw: string): FieldTransformResult {
  const match = raw.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number.parseFloat(match[1]!)
  return Number.isFinite(value) ? value : null
}

const TRANSFORMS: Record<FieldTransformName, FieldTransformFn> = {
  trimText,
  parsePrice,
  parseInches,
}

/**
 * Resolves a `FieldMapping.transform` name against the fixed transform
 * library and applies it to a raw extracted string.
 *
 * `transform: null` (no transform configured) and an unrecognized transform
 * name both fall back to `trimText` — a safe, lossless default rather than a
 * thrown error, since an unknown name is far more likely to be a forward-
 * compatible field awaiting a not-yet-shipped transform than a signal to
 * abort the whole extraction.
 */
export function applyFieldTransform(name: string | null, raw: string): FieldTransformResult {
  const fn = name !== null && Object.hasOwn(TRANSFORMS, name) ? TRANSFORMS[name as FieldTransformName] : trimText
  return fn(raw)
}
