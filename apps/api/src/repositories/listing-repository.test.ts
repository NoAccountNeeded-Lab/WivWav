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
      { sourceId: 'source-1', observedActive: 10, eligibleActive: 3, possiblyGoneCount: 2 },
    ])
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.getPublicationCountsBySource()).resolves.toEqual([
      { sourceId: 'source-1', observedActive: 10, eligibleActive: 3, possiblyGoneCount: 2 },
    ])
  })
})

// ── Quarantine ──────────────────────────────────────────────────────────────

describe('PrismaListingRepository.findQuarantined', () => {
  it('filters by publicationStatus quarantined and maps the source name + latest extractionVersion onto the row', async () => {
    const row = {
      id: 'l-1',
      sourceId: 'src-1',
      sourceUrl: 'https://example.com/l-1',
      sourceRecordKey: 'rec-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      qualityIssueCodes: ['contains_space'],
      qualityCheckedAt: new Date('2026-06-01'),
      scrapedAt: new Date('2026-06-01'),
      updatedAt: new Date('2026-06-01'),
      source: { name: 'BLVD.com' },
      observations: [{ extractionVersion: 'detail-v2-evidence' }],
    }
    const db = buildDb({ findMany: vi.fn(async () => [row]) })
    const repo = new PrismaListingRepository(db as never)

    const result = await repo.findQuarantined({})

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicationStatus: 'quarantined' },
      skip: 0,
      take: 50,
      select: expect.objectContaining({
        observations: { orderBy: { observedAt: 'desc' }, take: 1, select: { extractionVersion: true } },
      }),
    }))
    expect(result).toEqual([{
      id: 'l-1',
      sourceId: 'src-1',
      sourceName: 'BLVD.com',
      sourceUrl: 'https://example.com/l-1',
      sourceRecordKey: 'rec-1',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      qualityIssueCodes: ['contains_space'],
      qualityCheckedAt: row.qualityCheckedAt,
      scrapedAt: row.scrapedAt,
      updatedAt: row.updatedAt,
      extractionVersion: 'detail-v2-evidence',
    }])
  })

  it('returns extractionVersion null when the listing has no observation history yet', async () => {
    const row = {
      id: 'l-2',
      sourceId: 'src-1',
      sourceUrl: 'https://example.com/l-2',
      sourceRecordKey: 'rec-2',
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      qualityIssueCodes: ['contains_space'],
      qualityCheckedAt: new Date('2026-06-01'),
      scrapedAt: new Date('2026-06-01'),
      updatedAt: new Date('2026-06-01'),
      source: { name: 'BLVD.com' },
      observations: [],
    }
    const db = buildDb({ findMany: vi.fn(async () => [row]) })
    const repo = new PrismaListingRepository(db as never)

    const result = await repo.findQuarantined({})

    expect(result[0]!.extractionVersion).toBeNull()
  })

  it('filters by sourceId and a single rule', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findQuarantined({ sourceId: 'src-1', rule: 'contains_space' })

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        publicationStatus: 'quarantined',
        sourceId: 'src-1',
        qualityIssueCodes: { has: 'contains_space' },
      },
    }))
  })

  it('filters by an array of rules using hasSome (severity resolution)', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findQuarantined({ rule: ['contains_space', 'active_with_sold_at'] })

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        publicationStatus: 'quarantined',
        qualityIssueCodes: { hasSome: ['contains_space', 'active_with_sold_at'] },
      },
    }))
  })

  it('filters by age via olderThanMs', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findQuarantined({ olderThanMs: 1000 })

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        publicationStatus: 'quarantined',
        OR: expect.any(Array),
      }),
    }))
  })

  it('respects skip and take', async () => {
    const db = buildDb()
    const repo = new PrismaListingRepository(db as never)

    await repo.findQuarantined({ skip: 20, take: 10 })

    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }))
  })
})

describe('PrismaListingRepository.countQuarantined', () => {
  it('applies the same where clause as findQuarantined', async () => {
    const db = buildDb({ count: vi.fn(async () => 3) })
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.countQuarantined({ sourceId: 'src-1' })).resolves.toBe(3)
    expect(db.listing.count).toHaveBeenCalledWith({
      where: { publicationStatus: 'quarantined', sourceId: 'src-1' },
    })
  })
})

describe('PrismaListingRepository.reprocessQuarantined', () => {
  it('resets a quarantined listing to pending and returns true', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const db = buildDb({ updateMany })
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.reprocessQuarantined('l-1')).resolves.toBe(true)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'l-1', publicationStatus: 'quarantined' },
      data: { publicationStatus: 'pending', qualityIssueCodes: [], qualityCheckedAt: null },
    })
  })

  it('returns false when the listing was not quarantined', async () => {
    const db = buildDb({ updateMany: vi.fn(async () => ({ count: 0 })) })
    const repo = new PrismaListingRepository(db as never)

    await expect(repo.reprocessQuarantined('l-2')).resolves.toBe(false)
  })
})

describe('PrismaListingRepository.getSourcePipelineStages', () => {
  function buildPipelineDb() {
    return {
      listing: {
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async (): Promise<{ _max: { detailScrapedAt: Date | null; updatedAt: Date | null } }> => (
          { _max: { detailScrapedAt: null, updatedAt: null } }
        )),
      },
      rawPage: {
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async (): Promise<{ _max: { processedAt: Date | null } }> => (
          { _max: { processedAt: null } }
        )),
      },
    }
  }

  it('returns pending counts and last-completed timestamps for each DB-derivable stage', async () => {
    const detailCrawledAt = new Date('2026-06-17T00:00:00Z')
    const extractedAt = new Date('2026-06-18T00:00:00Z')
    const geocodedAt = new Date('2026-06-18T05:00:00Z')
    const vinEnrichedAt = new Date('2026-06-18T06:00:00Z')

    const db = buildPipelineDb()
    db.listing.count
      .mockResolvedValueOnce(5) // pendingDetailCrawl
      .mockResolvedValueOnce(2) // pendingGeocode
      .mockResolvedValueOnce(1) // pendingVinEnrich
    db.listing.aggregate
      .mockResolvedValueOnce({ _max: { detailScrapedAt: detailCrawledAt, updatedAt: null } })
      .mockResolvedValueOnce({ _max: { detailScrapedAt: null, updatedAt: geocodedAt } })
      .mockResolvedValueOnce({ _max: { detailScrapedAt: null, updatedAt: vinEnrichedAt } })
    db.rawPage.count.mockResolvedValueOnce(3) // pendingDetailExtract
    db.rawPage.aggregate.mockResolvedValueOnce({ _max: { processedAt: extractedAt } })

    const repo = new PrismaListingRepository(db as never)
    const stages = await repo.getSourcePipelineStages('src-1')

    expect(stages).toEqual([
      { stage: 'detail-crawl', pendingCount: 5, lastCompletedAt: detailCrawledAt },
      { stage: 'detail-extract', pendingCount: 3, lastCompletedAt: extractedAt },
      { stage: 'geocode', pendingCount: 2, lastCompletedAt: geocodedAt },
      { stage: 'vin-enrich', pendingCount: 1, lastCompletedAt: vinEnrichedAt },
    ])

    expect(db.listing.count).toHaveBeenNthCalledWith(1, {
      where: {
        sourceId: 'src-1',
        status: { not: 'gone' },
        OR: [{ detailScrapedAt: null }, { detailScrapedAt: { lt: expect.any(Date) } }],
      },
    })
    expect(db.rawPage.count).toHaveBeenCalledWith({ where: { sourceId: 'src-1', processedAt: null } })
  })

  it('returns null lastCompletedAt for a stage that has never completed', async () => {
    const db = buildPipelineDb()
    const repo = new PrismaListingRepository(db as never)
    const stages = await repo.getSourcePipelineStages('src-empty')

    for (const stage of stages) {
      expect(stage.pendingCount).toBe(0)
      expect(stage.lastCompletedAt).toBeNull()
    }
  })
})
