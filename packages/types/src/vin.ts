/**
 * VIN normalization and structural validation.
 *
 * Validates: trim, uppercase, strip non-alphanumeric, 17-character length,
 * no I/O/Q characters, and North American check-digit (position 9).
 */

const FORBIDDEN_VIN_CHARS = /[IOQ]/

// Transliteration table for the North American VIN check-digit algorithm.
// Maps each valid VIN character to its numeric value.
const TRANSLITERATION: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5,         P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

// Position weights for the check-digit algorithm (indices 0–16).
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

/**
 * Normalize a raw VIN string: trim whitespace, uppercase, and strip any
 * characters that are not alphanumeric (e.g., hyphens used for display).
 * Returns the normalized string (may still be invalid — call isValidVin to check).
 */
export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Returns true if the VIN passes structural validation:
 * - Exactly 17 characters after normalization
 * - No characters I, O, or Q (which are excluded from the VIN alphabet)
 */
export function isValidVin(vin: string): boolean {
  if (vin.length !== 17) return false
  if (FORBIDDEN_VIN_CHARS.test(vin)) return false
  return true
}

/**
 * Returns true if the VIN passes the North American check-digit test (position 9).
 * Assumes the VIN has already passed isValidVin (17 chars, no I/O/Q).
 * Non-North-American VINs (WMI starting with a digit >= 9 from certain regions)
 * may legitimately fail this test — callers should treat failure as a quality
 * signal, not a hard reject.
 */
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
