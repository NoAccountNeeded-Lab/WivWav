import type { PrismaClient, Vehicle } from '../generated/prisma/index.js'

export interface VehicleIdentity {
  vin: string
  make: string
  model: string
  year: number
  trim: string | null
  vehicleModelId: string | null
  /** Observation time from the listing (scrapedAt), used to update lastSeenAt */
  observedAt: Date
}

/**
 * Find or create a Vehicle row for a valid, normalized VIN.
 *
 * - vehicleModelId is set once at creation; later observations do not overwrite it.
 * - lastSeenAt is updated on every observation using the listing's scrapedAt time.
 * - Tolerates concurrent inserts: on unique-constraint violation (P2002), re-fetches the row.
 */
export async function findOrCreateVehicle(
  db: PrismaClient,
  identity: VehicleIdentity,
): Promise<Vehicle> {
  const existing = await db.vehicle.findUnique({ where: { vin: identity.vin } })

  if (existing) {
    // Update lastSeenAt if the observation is newer
    if (identity.observedAt > existing.lastSeenAt) {
      return db.vehicle.update({
        where: { id: existing.id },
        data: { lastSeenAt: identity.observedAt },
      })
    }
    return existing
  }

  try {
    return await db.vehicle.create({
      data: {
        vin: identity.vin,
        make: identity.make,
        model: identity.model,
        year: identity.year,
        trim: identity.trim,
        vehicleModelId: identity.vehicleModelId,
        firstSeenAt: identity.observedAt,
        lastSeenAt: identity.observedAt,
      },
    })
  } catch (err) {
    // P2002 = unique constraint violation — concurrent insert; re-fetch the winner
    if (isPrismaUniqueError(err)) {
      const winner = await db.vehicle.findUnique({ where: { vin: identity.vin } })
      if (!winner) throw new Error(`Vehicle re-fetch after P2002 returned null for vin ${identity.vin}`)
      return winner
    }
    throw err
  }
}

function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  )
}
