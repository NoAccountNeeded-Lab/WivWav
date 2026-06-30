import type { Prisma, PrismaClient, VehicleIdentityDecision } from '../generated/prisma/index.js'
import { VehicleIdentityDecisionState } from '../generated/prisma/index.js'

export { VehicleIdentityDecisionState }

export interface VehicleIdentityDecisionInput {
  /** One of the two listings being compared. Order does not matter — see {@link orderListingPair}. */
  listingAId: string
  /** The other listing being compared. */
  listingBId: string
  /** The vehicle the pair was linked to, if the decision resulted in a link (e.g. `verified`). */
  vehicleId?: string | null
  state: VehicleIdentityDecisionState
  /** Contributing/conflicting signals behind the decision, retained in full for audit. */
  signals: Prisma.InputJsonValue
  /** The rule or matcher version that produced this decision. */
  ruleId?: string | null
  /** When the decision was made. Defaults to now. */
  decidedAt?: Date
}

/**
 * Order a listing pair deterministically (lexicographically by id) so a given
 * pair of listings always maps to a single canonical (listingAId, listingBId)
 * regardless of the order callers compare them in. This is what makes the
 * unique constraint on (listingAId, listingBId) an effective idempotency key.
 */
export function orderListingPair(listingId1: string, listingId2: string): [string, string] {
  return listingId1 < listingId2 ? [listingId1, listingId2] : [listingId2, listingId1]
}

/**
 * Idempotently record a vehicle-identity matching decision for a listing pair.
 *
 * - The listing pair is normalized via {@link orderListingPair} before writing,
 *   so the unique constraint on (listingAId, listingBId) is always hit on retry.
 * - Rerunning the same decision (e.g. a retried job) upserts in place rather than
 *   creating a duplicate row.
 * - Prisma's `upsert` is already atomic at the DB level (ON CONFLICT DO UPDATE),
 *   so a P2002 unique-constraint error should not normally occur here. The retry
 *   below is a defensive fallback, not a fix for a real read-then-write race
 *   (contrast with vehicle-upsert.ts, which does a manual findUnique-then-create
 *   and therefore does have a genuine race to retry around).
 */
export async function upsertVehicleIdentityDecision(
  db: PrismaClient,
  input: VehicleIdentityDecisionInput,
): Promise<VehicleIdentityDecision> {
  const [listingAId, listingBId] = orderListingPair(input.listingAId, input.listingBId)
  const decidedAt = input.decidedAt ?? new Date()

  const data = {
    vehicleId: input.vehicleId ?? null,
    state: input.state,
    signals: input.signals,
    ruleId: input.ruleId ?? null,
    decidedAt,
  }

  try {
    return await db.vehicleIdentityDecision.upsert({
      where: { listingAId_listingBId: { listingAId, listingBId } },
      create: { listingAId, listingBId, ...data },
      update: data,
    })
  } catch (err) {
    // P2002 = unique constraint violation — a concurrent writer won the race
    // between our pre-upsert read and write. Retry as an update against the
    // row the concurrent writer just created.
    if (isPrismaUniqueError(err)) {
      return db.vehicleIdentityDecision.update({
        where: { listingAId_listingBId: { listingAId, listingBId } },
        data,
      })
    }
    throw err
  }
}

/** All identity decisions involving a given listing, on either side of the pair. */
export function findVehicleIdentityDecisionsByListing(
  db: PrismaClient,
  listingId: string,
): Promise<VehicleIdentityDecision[]> {
  return db.vehicleIdentityDecision.findMany({
    where: { OR: [{ listingAId: listingId }, { listingBId: listingId }] },
    orderBy: { decidedAt: 'desc' },
  })
}

/** All identity decisions that resulted in a link to a given vehicle. */
export function findVehicleIdentityDecisionsByVehicle(
  db: PrismaClient,
  vehicleId: string,
): Promise<VehicleIdentityDecision[]> {
  return db.vehicleIdentityDecision.findMany({
    where: { vehicleId },
    orderBy: { decidedAt: 'desc' },
  })
}

function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  )
}
