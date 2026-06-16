import { describe, expect, it, vi } from 'vitest'
import { PrismaListingRepository } from './listing-repository.js'

function buildDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      ...overrides,
    },
    listingPriceHistory: {
      findMany: vi.fn(async () => []),
    },
    vehicleModel: {
      findUnique: vi.fn(async () => null),
    },
  }
}

describe('PrismaListingRepository.findPageForSync', () => {
  it('omits cursor when afterId is undefined', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)
    await repo.findPageForSync(10)
    expect(db.listing.findMany).toHaveBeenCalledWith({
      take: 10,
      orderBy: { id: 'asc' },
    })
  })

  it('applies skip:1 and cursor when afterId is provided', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)
    await repo.findPageForSync(10, 'listing-abc')
    expect(db.listing.findMany).toHaveBeenCalledWith({
      take: 10,
      skip: 1,
      cursor: { id: 'listing-abc' },
      orderBy: { id: 'asc' },
    })
  })

  it('returns the listings from Prisma', async () => {
    const rows = [{ id: 'l-1' }, { id: 'l-2' }]
    const db = buildDb({ findMany: vi.fn(async () => rows) })
    const repo = new PrismaListingRepository(db as never)
    const result = await repo.findPageForSync(5)
    expect(result).toEqual(rows)
  })
})

describe('PrismaListingRepository.findManyActive', () => {
  it('queries with status:active filter ordered by listedAt desc', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)
    await repo.findManyActive(10, 5)
    expect(db.listing.findMany).toHaveBeenCalledWith({
      skip: 10,
      take: 5,
      where: { status: 'active' },
      orderBy: { listedAt: 'desc' },
    })
  })
})

describe('PrismaListingRepository.countActive', () => {
  it('counts with status:active filter', async () => {
    const db = buildDb({ count: vi.fn(async () => 7) })
    const repo = new PrismaListingRepository(db as never)
    const result = await repo.countActive()
    expect(result).toBe(7)
    expect(db.listing.count).toHaveBeenCalledWith({ where: { status: 'active' } })
  })
})
