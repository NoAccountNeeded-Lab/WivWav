import type { PrismaClient, VehicleIdentityDecision } from '@wivwav/db'
import { type Prisma, VehicleIdentityDecisionState, upsertVehicleIdentityDecision } from '@wivwav/db'

export { VehicleIdentityDecisionState }

/**
 * A candidate row as returned by the list endpoint, including key listing fields
 * for operator context (make/model/year/trim, price, mileage, source URL, VIN).
 */
export interface CandidateListingSnapshot {
  id: string
  make: string
  model: string
  year: number
  trim: string | null
  vin: string | null
  priceCents: number | null
  mileage: number | null
  sourceUrl: string
  city: string | null
  state: string | null
  dealerName: string | null
}

export interface CandidateRow {
  id: string
  listingAId: string
  listingBId: string
  vehicleId: string | null
  state: VehicleIdentityDecisionState
  signals: unknown
  ruleId: string | null
  decidedAt: Date
  createdAt: Date
  updatedAt: Date
  listingA: CandidateListingSnapshot
  listingB: CandidateListingSnapshot
}

const LISTING_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  trim: true,
  vin: true,
  priceCents: true,
  mileage: true,
  sourceUrl: true,
  city: true,
  state: true,
  dealerName: true,
} as const

export interface VehicleIdentityDecisionRepository {
  /** List all decisions in `candidate` state, newest first, with listing snapshots. */
  listCandidates(opts?: { skip?: number; take?: number }): Promise<{ data: CandidateRow[]; total: number }>

  /** Fetch a single decision row by id — any state. */
  findById(id: string): Promise<VehicleIdentityDecision | null>

  /**
   * Approve: transition to `verified`, find-or-create a shared Vehicle, and
   * update both listings' `vehicleId`. Idempotent — re-approving the same
   * candidate reuses the existing vehicleId if one was already assigned.
   */
  approve(id: string): Promise<VehicleIdentityDecision>

  /**
   * Reject: transition to `rejected`, clearing vehicleId.
   * Idempotent — re-rejecting is a no-op on state.
   */
  reject(id: string): Promise<VehicleIdentityDecision>

  /**
   * Split: transition to `split`, unlinking both listings from the shared
   * vehicle by clearing their `vehicleId`.
   * Idempotent — re-splitting is a no-op on state.
   */
  split(id: string): Promise<VehicleIdentityDecision>

  /**
   * Undo split: transition a `split` decision back to `candidate`, leaving
   * `vehicleId` null so the operator can re-approve if desired.
   * Idempotent — calling undo on a non-split decision is a no-op.
   */
  undoSplit(id: string): Promise<VehicleIdentityDecision>
}

export class PrismaVehicleIdentityDecisionRepository
  implements VehicleIdentityDecisionRepository {
  constructor(private readonly db: PrismaClient) {}

  async listCandidates(
    opts: { skip?: number; take?: number } = {},
  ): Promise<{ data: CandidateRow[]; total: number }> {
    const skip = opts.skip ?? 0
    const take = opts.take ?? 50

    const [rows, total] = await Promise.all([
      this.db.vehicleIdentityDecision.findMany({
        where: { state: VehicleIdentityDecisionState.candidate },
        orderBy: { decidedAt: 'desc' },
        skip,
        take,
        include: {
          listingA: { select: LISTING_SELECT },
          listingB: { select: LISTING_SELECT },
        },
      }),
      this.db.vehicleIdentityDecision.count({
        where: { state: VehicleIdentityDecisionState.candidate },
      }),
    ])

    return { data: rows as CandidateRow[], total }
  }

  findById(id: string): Promise<VehicleIdentityDecision | null> {
    return this.db.vehicleIdentityDecision.findUnique({ where: { id } })
  }

  async approve(id: string): Promise<VehicleIdentityDecision> {
    const decision = await this.db.vehicleIdentityDecision.findUnique({
      where: { id },
      include: {
        listingA: { select: { id: true, make: true, model: true, year: true, trim: true, vehicleId: true } },
        listingB: { select: { id: true, make: true, model: true, year: true, trim: true, vehicleId: true } },
      },
    })
    if (!decision) throw new NotFoundError(`Vehicle identity decision "${id}" not found`)

    // Idempotent: if already verified, return as-is (vehicleId already set)
    if (decision.state === VehicleIdentityDecisionState.verified && decision.vehicleId) {
      return decision
    }

    // Reuse existing vehicleId from either listing, or create a new one
    const listingA = decision.listingA as { id: string; make: string; model: string; year: number; trim: string | null; vehicleId: string | null }
    const listingB = decision.listingB as { id: string; make: string; model: string; year: number; trim: string | null; vehicleId: string | null }
    const existingVehicleId = decision.vehicleId ?? listingA.vehicleId ?? listingB.vehicleId

    let vehicleId: string
    if (existingVehicleId) {
      vehicleId = existingVehicleId
    } else {
      // Create a new non-VIN vehicle anchored to listing A's attributes.
      // Non-VIN vehicles have no unique constraint beyond their generated id,
      // so a plain create is safe here (no vin = no duplicate-vin race).
      const vehicle = await this.db.vehicle.create({
        data: {
          make: listingA.make,
          model: listingA.model,
          year: listingA.year,
          trim: listingA.trim,
        },
      })
      vehicleId = vehicle.id
    }

    // Link both listings to the vehicle
    await Promise.all([
      this.db.listing.update({ where: { id: listingA.id }, data: { vehicleId } }),
      this.db.listing.update({ where: { id: listingB.id }, data: { vehicleId } }),
    ])

    return upsertVehicleIdentityDecision(this.db, {
      listingAId: decision.listingAId,
      listingBId: decision.listingBId,
      vehicleId,
      state: VehicleIdentityDecisionState.verified,
      signals: toInputJson(decision.signals),
      ruleId: decision.ruleId,
      decidedAt: new Date(),
    })
  }

  async reject(id: string): Promise<VehicleIdentityDecision> {
    const decision = await this.db.vehicleIdentityDecision.findUnique({ where: { id } })
    if (!decision) throw new NotFoundError(`Vehicle identity decision "${id}" not found`)

    // Idempotent: already rejected
    if (decision.state === VehicleIdentityDecisionState.rejected) return decision

    return upsertVehicleIdentityDecision(this.db, {
      listingAId: decision.listingAId,
      listingBId: decision.listingBId,
      vehicleId: null,
      state: VehicleIdentityDecisionState.rejected,
      signals: toInputJson(decision.signals),
      ruleId: decision.ruleId,
      decidedAt: new Date(),
    })
  }

  async split(id: string): Promise<VehicleIdentityDecision> {
    const decision = await this.db.vehicleIdentityDecision.findUnique({ where: { id } })
    if (!decision) throw new NotFoundError(`Vehicle identity decision "${id}" not found`)

    // Idempotent: already split
    if (decision.state === VehicleIdentityDecisionState.split) return decision

    // Unlink both listings from the shared vehicle
    if (decision.vehicleId) {
      await Promise.all([
        this.db.listing.updateMany({
          where: { vehicleId: decision.vehicleId, id: { in: [decision.listingAId, decision.listingBId] } },
          data: { vehicleId: null },
        }),
      ])
    }

    return upsertVehicleIdentityDecision(this.db, {
      listingAId: decision.listingAId,
      listingBId: decision.listingBId,
      vehicleId: null,
      state: VehicleIdentityDecisionState.split,
      signals: toInputJson(decision.signals),
      ruleId: decision.ruleId,
      decidedAt: new Date(),
    })
  }

  async undoSplit(id: string): Promise<VehicleIdentityDecision> {
    const decision = await this.db.vehicleIdentityDecision.findUnique({ where: { id } })
    if (!decision) throw new NotFoundError(`Vehicle identity decision "${id}" not found`)

    // Idempotent: only act on split decisions
    if (decision.state !== VehicleIdentityDecisionState.split) return decision

    return upsertVehicleIdentityDecision(this.db, {
      listingAId: decision.listingAId,
      listingBId: decision.listingBId,
      vehicleId: null,
      state: VehicleIdentityDecisionState.candidate,
      signals: toInputJson(decision.signals),
      ruleId: decision.ruleId,
      decidedAt: new Date(),
    })
  }
}

/**
 * Prisma stores `signals` as `JsonValue` (which includes `null`) but
 * `upsertVehicleIdentityDecision` accepts `InputJsonValue` (which excludes `null`).
 * In practice, `signals` is never null — the scraper always writes at least `{}` —
 * but the type system doesn't know that. This helper narrows the type safely.
 */
function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}
