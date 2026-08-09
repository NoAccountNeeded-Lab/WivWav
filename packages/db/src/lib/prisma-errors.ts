/**
 * True for Prisma's "record not found" error (P2025). A row can be deleted
 * (or a stale scheduler/caller can outlive a DB reseed) while a write is in
 * flight — callers that treat this as a no-op instead of throwing avoid
 * crashing on a race that isn't actually their bug.
 */
export function isRecordNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['code'] === 'P2025'
}
