import { describe, expect, it, vi } from 'vitest'
import { PrismaMarketRepository } from './market-repository.js'

function sqlFromCall(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray
  return strings.join('?')
}

describe('PrismaMarketRepository.getPricingStats', () => {
  it('counts representative vehicle groups instead of legacy duplicate flags', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          count: 2,
          p10: null,
          p25: null,
          p50: null,
          p75: null,
          p90: null,
          medianMileage: null,
          medianDaysListed: null,
        }])
        .mockResolvedValueOnce([{ total: 2, dropped: 1 }]),
    }
    const repo = new PrismaMarketRepository(db as never)

    const result = await repo.getPricingStats('Toyota', 'Sienna', null, null)

    expect(result.count).toBe(2)
    const pricingSql = sqlFromCall(db.$queryRaw.mock.calls[0]!)
    const dropSql = sqlFromCall(db.$queryRaw.mock.calls[1]!)
    expect(pricingSql).toContain('DISTINCT ON (COALESCE("vehicleId", id))')
    expect(dropSql).toContain('DISTINCT ON (COALESCE("vehicleId", id))')
    expect(pricingSql).toContain('"publicationStatus" = \'eligible\'')
    expect(dropSql).toContain('"publicationStatus" = \'eligible\'')
    expect(pricingSql).not.toContain('"isDuplicate"')
    expect(dropSql).not.toContain('"isDuplicate"')
  })
})

describe('PrismaMarketRepository.getPopular', () => {
  it('builds popular stats from representative vehicle group queries', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ make: 'Toyota', count: 2 }])
        .mockResolvedValueOnce([{ make: 'Toyota', model: 'Sienna', count: 2 }])
        .mockResolvedValueOnce([{ conversionManufacturer: 'BraunAbility', count: 1 }]),
    }
    const repo = new PrismaMarketRepository(db as never)

    const result = await repo.getPopular()

    expect(result).toEqual({
      makes: [{ make: 'Toyota', count: 2 }],
      models: [{ make: 'Toyota', model: 'Sienna', count: 2 }],
      conversionBrands: [{ conversionManufacturer: 'BraunAbility', count: 1 }],
    })
    for (const call of db.$queryRaw.mock.calls) {
      const sql = sqlFromCall(call)
      expect(sql).toContain('DISTINCT ON (COALESCE("vehicleId", id))')
      expect(sql).toContain('"publicationStatus" = \'eligible\'')
      expect(sql).not.toContain('"isDuplicate"')
    }
  })
})
