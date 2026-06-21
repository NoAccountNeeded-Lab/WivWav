/**
 * VIN normalization and structural validation.
 *
 * v1 validates: trim, uppercase, 17-character length, no I/O/Q characters.
 * Check-digit validation (position 9) is deferred to a future iteration.
 */

const FORBIDDEN_VIN_CHARS = /[IOQ]/

/**
 * Normalize a raw VIN string: trim whitespace and uppercase.
 * Returns the normalized string (may still be invalid — call isValidVin to check).
 */
export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase()
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
