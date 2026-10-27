import type { getDb } from '@wivwav/db'

/**
 * How long a single-row lock is considered active before it is treated as stale.
 * Each listing is locked only for the duration of its own processing (seconds),
 * not the total job runtime — choose a value comfortably larger than the longest
 * expected per-row processing time (e.g. one HTTP call + DB write).
 */
export const LOCK_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Attempt to acquire a processing lock on a single listing row.
 *
 * Uses an atomic UPDATE … WHERE to avoid TOCTOU races:
 *   - Only acquires if the row has no lock, or the existing lock is stale.
 *   - Returns `true` when the lock was successfully acquired.
 *   - Returns `false` when another job holds an active lock on this row.
 *
 * Callers must call `releaseListingLock` when done, even on failure.
 */
export async function acquireListingLock(
  db: ReturnType<typeof getDb>,
  listingId: string,
): Promise<boolean> {
  return (await claimListingLock(db, listingId)) !== null
}

/**
 * Same atomic claim as `acquireListingLock`, but returns the lock timestamp as
 * an ownership token (`null` when a live lock is held). Pass the token to
 * `releaseOwnedListingLock` so a release can never clear a lock that a later
 * claimant took over after this one went stale.
 */
export async function claimListingLock(
  db: ReturnType<typeof getDb>,
  listingId: string,
): Promise<Date | null> {
  const now = new Date()
  const staleThreshold = new Date(now.getTime() - LOCK_TTL_MS)

  const result = await db.$executeRaw`
    UPDATE listings
    SET "processingLockedAt" = ${now}
    WHERE id = ${listingId}
      AND (
        "processingLockedAt" IS NULL
        OR "processingLockedAt" < ${staleThreshold}
      )
  `

  // executeRaw returns the number of rows affected
  return result === 1 ? now : null
}

/** Releases the lock only if it is still the one stamped by `claimListingLock`. */
export async function releaseOwnedListingLock(
  db: ReturnType<typeof getDb>,
  listingId: string,
  lockedAt: Date,
): Promise<void> {
  await db.listing.updateMany({
    where: { id: listingId, processingLockedAt: lockedAt },
    data: { processingLockedAt: null },
  })
}

/**
 * Release the processing lock on a listing row.
 * Always call this after processing, regardless of success or failure.
 */
export async function releaseListingLock(
  db: ReturnType<typeof getDb>,
  listingId: string,
): Promise<void> {
  await db.listing.update({
    where: { id: listingId },
    data: { processingLockedAt: null },
  })
}

/**
 * Release locks on multiple listing rows at once (e.g. on job completion or error).
 */
export async function releaseListingLocks(
  db: ReturnType<typeof getDb>,
  listingIds: string[],
): Promise<void> {
  if (listingIds.length === 0) return
  await db.listing.updateMany({
    where: { id: { in: listingIds } },
    data: { processingLockedAt: null },
  })
}

/**
 * Returns a Prisma where fragment that matches rows that are NOT actively locked:
 *   - processingLockedAt IS NULL, OR
 *   - processingLockedAt < staleThreshold
 */
export function unlockableWhere(): {
  OR: [
    { processingLockedAt: null },
    { processingLockedAt: { lt: Date } },
  ]
} {
  const staleThreshold = new Date(Date.now() - LOCK_TTL_MS)
  return {
    OR: [
      { processingLockedAt: null },
      { processingLockedAt: { lt: staleThreshold } },
    ],
  }
}
