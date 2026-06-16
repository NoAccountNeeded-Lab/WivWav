import { describe, expect, it, vi } from 'vitest'
import { PrismaVehicleRepository } from './vehicle-repository.js'

const baseStats = {
  make: 'Toyota',
  model: 'Sienna',
  year: null,
  avgLifespanMiles: null,
  reliabilityScore: null,
  reliabilitySource: null,
  jdPowerScore: null,
  dataSourceName: null,
  dataSourceUrl: null,
  methodology: null,
  refreshedAt: null,
}

function buildDb(vehicleStatsOverrides: Record<string, unknown> = {}) {
  return {
    vehicleModel: {
      findFirst: vi.fn(async () => null),
    },
    vehicleStats: {
      findFirst: vi.fn(async () => null),
      ...vehicleStatsOverrides,
    },
    recall: {
      findMany: vi.fn(async () => []),
    },
    complaint: {
      findMany: vi.fn(async () => []),
    },
    vehicleModelResearch: {
      findFirst: vi.fn(async () => null),
    },
  }
}

describe('PrismaVehicleRepository.findStats — year is null', () => {
  it('queries only the year:null row when year is null', async () => {
    const db = buildDb({ findFirst: vi.fn(async () => baseStats) })
    const repo = new PrismaVehicleRepository(db as never)
    const result = await repo.findStats('Toyota', 'Sienna', null)
    expect(result).toEqual(baseStats)
    expect(db.vehicleStats.findFirst).toHaveBeenCalledOnce()
    expect(db.vehicleStats.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ year: null }) }),
    )
  })

  it('returns null when no year:null row exists and year is null', async () => {
    const db = buildDb({ findFirst: vi.fn(async () => null) })
    const repo = new PrismaVehicleRepository(db as never)
    const result = await repo.findStats('Toyota', 'Sienna', null)
    expect(result).toBeNull()
    expect(db.vehicleStats.findFirst).toHaveBeenCalledOnce()
  })
})

describe('PrismaVehicleRepository.findStats — year is provided', () => {
  it('returns the year-specific row without a fallback query when found', async () => {
    const yearStats = { ...baseStats, year: 2020 }
    const db = buildDb({ findFirst: vi.fn(async () => yearStats) })
    const repo = new PrismaVehicleRepository(db as never)
    const result = await repo.findStats('Toyota', 'Sienna', 2020)
    expect(result).toEqual(yearStats)
    expect(db.vehicleStats.findFirst).toHaveBeenCalledOnce()
    expect(db.vehicleStats.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ year: 2020 }) }),
    )
  })

  it('falls back to the year:null row when year-specific row is missing', async () => {
    const db = buildDb({
      findFirst: vi.fn()
        .mockResolvedValueOnce(null)       // year-specific miss
        .mockResolvedValueOnce(baseStats), // generic fallback
    })
    const repo = new PrismaVehicleRepository(db as never)
    const result = await repo.findStats('Toyota', 'Sienna', 2020)
    expect(result).toEqual(baseStats)
    expect(db.vehicleStats.findFirst).toHaveBeenCalledTimes(2)
    const calls = db.vehicleStats.findFirst.mock.calls as unknown as [[{ where: { year: unknown } }], [{ where: { year: unknown } }]]
    expect(calls[0][0].where.year).toBe(2020)
    expect(calls[1][0].where.year).toBeNull()
  })

  it('returns null when neither year-specific nor generic row exists', async () => {
    const db = buildDb({
      findFirst: vi.fn().mockResolvedValue(null),
    })
    const repo = new PrismaVehicleRepository(db as never)
    const result = await repo.findStats('Toyota', 'Sienna', 2020)
    expect(result).toBeNull()
    expect(db.vehicleStats.findFirst).toHaveBeenCalledTimes(2)
  })
})
