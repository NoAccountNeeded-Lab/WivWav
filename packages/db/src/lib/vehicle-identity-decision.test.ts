import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  upsertVehicleIdentityDecision,
  orderListingPair,
  findVehicleIdentityDecisionsByListing,
  findVehicleIdentityDecisionsByVehicle,
  VehicleIdentityDecisionState,
} from './vehicle-identity-decision.js'
import type { PrismaClient, VehicleIdentityDecision } from '../generated/prisma/index.js'

function makeDecision(overrides: Partial<VehicleIdentityDecision> = {}): VehicleIdentityDecision {
  return {
    id: 'decision-1',
    listingAId: 'listing-a',
    listingBId: 'listing-b',
    vehicleId: null,
    state: VehicleIdentityDecisionState.candidate,
    signals: {},
    ruleId: null,
    decidedAt: new Date('2026-06-30T00:00:00Z'),
    createdAt: new Date('2026-06-30T00:00:00Z'),
    updatedAt: new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  } as VehicleIdentityDecision
}

describe('orderListingPair', () => {
  it('orders ids lexicographically regardless of input order', () => {
    expect(orderListingPair('listing-b', 'listing-a')).toEqual(['listing-a', 'listing-b'])
    expect(orderListingPair('listing-a', 'listing-b')).toEqual(['listing-a', 'listing-b'])
  })

  it('is stable for equal ids (degenerate, should not happen in practice)', () => {
    expect(orderListingPair('listing-a', 'listing-a')).toEqual(['listing-a', 'listing-a'])
  })
})

describe('upsertVehicleIdentityDecision', () => {
  let db: {
    vehicleIdentityDecision: {
      upsert: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      findMany: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    db = {
      vehicleIdentityDecision: {
        upsert: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    }
  })

  it('normalizes the listing pair before writing so retries hit the same row', async () => {
    db.vehicleIdentityDecision.upsert.mockResolvedValue(makeDecision())

    await upsertVehicleIdentityDecision(db as unknown as PrismaClient, {
      listingAId: 'listing-b',
      listingBId: 'listing-a',
      state: VehicleIdentityDecisionState.candidate,
      signals: { vinMatch: false },
    })

    expect(db.vehicleIdentityDecision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listingAId_listingBId: { listingAId: 'listing-a', listingBId: 'listing-b' } },
        create: expect.objectContaining({ listingAId: 'listing-a', listingBId: 'listing-b' }),
      }),
    )
  })

  it('writing the same decision twice upserts in place rather than creating a duplicate', async () => {
    db.vehicleIdentityDecision.upsert.mockResolvedValue(makeDecision())

    const input = {
      listingAId: 'listing-a',
      listingBId: 'listing-b',
      state: VehicleIdentityDecisionState.verified,
      vehicleId: 'vehicle-1',
      signals: { vinMatch: true },
      ruleId: 'rule-vin-exact',
    }

    await upsertVehicleIdentityDecision(db as unknown as PrismaClient, input)
    await upsertVehicleIdentityDecision(db as unknown as PrismaClient, input)

    expect(db.vehicleIdentityDecision.upsert).toHaveBeenCalledTimes(2)
    const calls = db.vehicleIdentityDecision.upsert.mock.calls
    expect(calls[0]?.[0].where).toEqual(calls[1]?.[0].where)
  })

  it('defaults decidedAt to now when not provided', async () => {
    db.vehicleIdentityDecision.upsert.mockResolvedValue(makeDecision())

    await upsertVehicleIdentityDecision(db as unknown as PrismaClient, {
      listingAId: 'listing-a',
      listingBId: 'listing-b',
      state: VehicleIdentityDecisionState.candidate,
      signals: {},
    })

    const call = db.vehicleIdentityDecision.upsert.mock.calls[0]?.[0]
    expect(call.create.decidedAt).toBeInstanceOf(Date)
  })

  it('retries as an update when a concurrent writer wins the unique-constraint race (P2002)', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    db.vehicleIdentityDecision.upsert.mockRejectedValue(p2002)
    db.vehicleIdentityDecision.update.mockResolvedValue(makeDecision({ state: VehicleIdentityDecisionState.rejected }))

    const result = await upsertVehicleIdentityDecision(db as unknown as PrismaClient, {
      listingAId: 'listing-a',
      listingBId: 'listing-b',
      state: VehicleIdentityDecisionState.rejected,
      signals: { vinMatch: false },
    })

    expect(db.vehicleIdentityDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listingAId_listingBId: { listingAId: 'listing-a', listingBId: 'listing-b' } },
      }),
    )
    expect(result.state).toBe(VehicleIdentityDecisionState.rejected)
  })

  it('rethrows non-P2002 errors without retrying', async () => {
    const dbError = new Error('connection lost')
    db.vehicleIdentityDecision.upsert.mockRejectedValue(dbError)

    await expect(
      upsertVehicleIdentityDecision(db as unknown as PrismaClient, {
        listingAId: 'listing-a',
        listingBId: 'listing-b',
        state: VehicleIdentityDecisionState.candidate,
        signals: {},
      }),
    ).rejects.toThrow('connection lost')
    expect(db.vehicleIdentityDecision.update).not.toHaveBeenCalled()
  })
})

describe('findVehicleIdentityDecisionsByListing', () => {
  it('queries decisions where the listing is on either side of the pair', async () => {
    const db = {
      vehicleIdentityDecision: { findMany: vi.fn().mockResolvedValue([makeDecision()]) },
    }

    const result = await findVehicleIdentityDecisionsByListing(db as unknown as PrismaClient, 'listing-a')

    expect(db.vehicleIdentityDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ listingAId: 'listing-a' }, { listingBId: 'listing-a' }] },
      }),
    )
    expect(result).toHaveLength(1)
  })
})

describe('findVehicleIdentityDecisionsByVehicle', () => {
  it('queries decisions linked to a given vehicle, with signal data intact', async () => {
    const decision = makeDecision({ vehicleId: 'vehicle-1', signals: { vinMatch: true, mileageDelta: 12 } })
    const db = {
      vehicleIdentityDecision: { findMany: vi.fn().mockResolvedValue([decision]) },
    }

    const result = await findVehicleIdentityDecisionsByVehicle(db as unknown as PrismaClient, 'vehicle-1')

    expect(db.vehicleIdentityDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vehicleId: 'vehicle-1' } }),
    )
    expect(result[0]?.signals).toEqual({ vinMatch: true, mileageDelta: 12 })
  })
})
