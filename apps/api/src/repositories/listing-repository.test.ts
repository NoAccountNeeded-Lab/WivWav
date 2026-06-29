import { describe, expect, it, vi } from 'vitest'
import { PrismaListingRepository } from './listing-repository.js'

function buildDb(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn(async (): Promise<unknown[]> => []),
    listing: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
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
      where: {
        status: 'active',
        publicationStatus: 'eligible',
      },
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
      where: {
        status: 'active',
        publicationStatus: 'eligible',
      },
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
  it('queries active representative vehicle groups ordered by listedAt desc', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)
    await repo.findManyActive(10, 5)
    const sql = (db.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0]![0].join('?')
    expect(sql).toContain('DISTINCT ON (COALESCE("vehicleId", id))')
    expect(sql).toContain('"publicationStatus" = \'eligible\'')
    expect(sql).toContain('LIMIT')
    expect(sql).toContain('OFFSET')
  })
})

describe('PrismaListingRepository.countActive', () => {
  it('counts active representative vehicle groups', async () => {
    const db = buildDb()
    ;(db as unknown as Record<string, unknown>).$queryRaw = vi.fn(async () => [{ count: 7 }])
    const repo = new PrismaListingRepository(db as never)
    const result = await repo.countActive()
    expect(result).toBe(7)
    const sql = (db.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[0]![0].join('?')
    expect(sql).toContain('COUNT(DISTINCT COALESCE("vehicleId", id))')
    expect(sql).toContain('"publicationStatus" = \'eligible\'')
  })
})

describe('PrismaListingRepository public eligibility', () => {
  it('requires active eligible status for direct listing detail', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findById('listing-1')

    expect(db.listing.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'listing-1',
        status: 'active',
        publicationStatus: 'eligible',
      },
      include: { source: { select: { name: true, baseUrl: true } } },
    })
  })

  it('requires active eligible status for cross-listings', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findCrossListingsByVehicleId('vehicle-1', 'listing-1')

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vehicleId: 'vehicle-1',
        status: 'active',
        publicationStatus: 'eligible',
        id: { not: 'listing-1' },
      },
    }))
  })

  it('counts observed active rows separately from eligible vehicle groups', async () => {
    const db = buildDb({ count: vi.fn(async () => 12) })
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.countObservedActive()).resolves.toBe(12)
    expect(db.listing.count).toHaveBeenCalledWith({ where: { status: 'active' } })
  })

  it('returns observed and eligible active counts by source', async () => {
    const db = buildDb()
    db.$queryRaw.mockResolvedValueOnce([
      { sourceId: 'source-1', observedActive: 10, eligibleActive: 3 },
    ])
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.getPublicationCountsBySource()).resolves.toEqual([
      { sourceId: 'source-1', observedActive: 10, eligibleActive: 3 },
    ])
  })
})
