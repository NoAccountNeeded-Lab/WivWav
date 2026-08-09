/**
 * VIN normalization and structural validation. Duplicated from
 * `packages/types/src/vin.ts` (re-exported by `@wivwav/db`) rather than
 * imported: these are pure functions with no database access, but importing
 * anything from `@wivwav/db` — even a type-only re-export — would put it in
 * this app's `package.json` dependency graph, violating the worker's
 * build-time no-DB invariant (#952). Keep in sync with the source of truth
 * if the check-digit algorithm ever changes.
 */

const FORBIDDEN_VIN_CHARS = /[IOQ]/

const TRANSLITERATION: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5,         P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidVin(vin: string): boolean {
  if (vin.length !== 17) return false
  if (FORBIDDEN_VIN_CHARS.test(vin)) return false
  return true
}

export function checkDigitValid(vin: string): boolean {
  if (vin.length !== 17) return false
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const char = vin[i]!
    const val = TRANSLITERATION[char]
    if (val === undefined) return false
    sum += val * WEIGHTS[i]!
  }
  const remainder = sum % 11
  const expected = remainder === 10 ? 'X' : String(remainder)
  return vin[8] === expected
}
