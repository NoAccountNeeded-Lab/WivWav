/**
 * Small runtime pickers used when mapping another route's already-serialized
 * JSON response into a diagnostic-gateway response (#775). Every diagnostic
 * route explicitly enumerates the fields it re-serves rather than spreading
 * an upstream object through — so a field this module doesn't know to pick
 * (e.g. a credential-shaped value some future upstream route accidentally
 * includes) is silently dropped instead of leaking into a diagnostic
 * response.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function pickString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function pickStringRequired(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function pickNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function pickBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}
