import { describe, it, expect, vi } from 'vitest'
import { PrismaListingRepository } from './prisma-repositories.js'
import { GONE_AFTER_CONSECUTIVE_MISSING } from '../engine/repositories.js'

function makeDb(countResult = 0) {
  return {
    listing: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(countResult),
    },
    listingPriceHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
  }
}

// ─── incomplete crawl ─────────────────────────────────────────────────────────

describe('PrismaListingRepository.markGone — incomplete crawl', () => {
  it('soft-marks active listings absent from the scraped set as possibly_gone', async () => {
    // For incomplete crawl the count comes from updateMany, not listing.count
    const db = makeDb(0)
    db.listing.updateMany.mockResolvedValue({ count: 3 })
    const repo = new PrismaListingRepository(db as never)

    const count = await repo.markGone('src-1', ['key-1', 'key-2'], { isCompleteCrawl: false })

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { sourceId: 'src-1', status: 'active', sourceRecordKey: { notIn: ['key-1', 'key-2'] } },
      data: { status: 'possibly_gone', detailScrapedAt: null },
    })
    expect(count).toBe(3)
  })

  it('returns 0 and does nothing when activeSourceRecordKeys is empty', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    const count = await repo.markGone('src-1', [], { isCompleteCrawl: false })

    expect(db.listing.updateMany).not.toHaveBeenCalled()
    expect(count).toBe(0)
  })

  it('returns 0 when all listings are still present (incomplete crawl)', async () => {
    const db = makeDb(0)
    db.listing.updateMany.mockResolvedValue({ count: 0 })
    const repo = new PrismaListingRepository(db as never)

    const count = await repo.markGone('src-1', ['key-1', 'key-2', 'key-3'], { isCompleteCrawl: false })

    expect(count).toBe(0)
  })

  it('does NOT increment missingFromCompleteCount on an incomplete crawl', async () => {
    const db = makeDb(0)
    db.listing.updateMany.mockResolvedValue({ count: 1 })
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['key-1'], { isCompleteCrawl: false })

    // The single updateMany call for incomplete crawl must not touch missingFromCompleteCount
    const calls = db.listing.updateMany.mock.calls
    expect(calls.length).toBe(1)
    expect(calls[0]![0].data).not.toHaveProperty('missingFromCompleteCount')
  })
})

// ─── complete crawl ───────────────────────────────────────────────────────────

describe('PrismaListingRepository.markGone — complete crawl', () => {
  it('returns 0 and does nothing when activeSourceRecordKeys is empty', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    const count = await repo.markGone('src-1', [], { isCompleteCrawl: true })

    expect(db.listing.updateMany).not.toHaveBeenCalled()
    expect(count).toBe(0)
  })

  it('returns the newly-missing count from listing.count (active absent before the update)', async () => {
    const db = makeDb(2) // 2 active listings newly absent
    const repo = new PrismaListingRepository(db as never)

    const count = await repo.markGone('src-1', ['seen-key'], { isCompleteCrawl: true })

    expect(db.listing.count).toHaveBeenCalledWith({
      where: { sourceId: 'src-1', status: 'active', sourceRecordKey: { notIn: ['seen-key'] } },
    })
    expect(count).toBe(2)
  })

  it('increments count for BOTH active and already-possibly_gone absent listings in one query (no double-increment)', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['seen'], { isCompleteCrawl: true })

    // The merged step 2+3: covers both 'active' and 'possibly_gone' in a single UPDATE
    expect(db.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: 'src-1',
        status: { in: ['active', 'possibly_gone'] },
        sourceRecordKey: { notIn: ['seen'] },
        missingFromCompleteCount: { lt: GONE_AFTER_CONSECUTIVE_MISSING },
      }),
      data: expect.objectContaining({
        status: 'possibly_gone',
        missingFromCompleteCount: { increment: 1 },
      }),
    }))
  })

  it('resets missingFromCompleteCount and restores possibly_gone listings seen in complete crawl', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['reappeared-key'], { isCompleteCrawl: true })

    // The reappearance reset call: possibly_gone listings that appear in the active set
    expect(db.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: 'src-1',
        status: 'possibly_gone',
        sourceRecordKey: { in: ['reappeared-key'] },
      }),
      data: expect.objectContaining({
        missingFromCompleteCount: 0,
        status: 'active',
        goneAt: null,
      }),
    }))
  })

  it('promotes possibly_gone listings to gone when the threshold is reached', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['seen'], { isCompleteCrawl: true })

    expect(db.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: 'src-1',
        status: 'possibly_gone',
        sourceRecordKey: { notIn: ['seen'] },
        missingFromCompleteCount: { gte: GONE_AFTER_CONSECUTIVE_MISSING },
      }),
      data: expect.objectContaining({ status: 'gone' }),
    }))
  })

  it('sets lastSeenInCompleteCrawlAt for seen listings on a complete crawl', async () => {
    const db = makeDb(0)
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['seen-key'], { isCompleteCrawl: true })

    expect(db.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: 'src-1',
        status: { not: 'gone' },
        sourceRecordKey: { in: ['seen-key'] },
      }),
      data: expect.objectContaining({ lastSeenInCompleteCrawlAt: expect.any(Date) }),
    }))
  })
})

// ─── off-page detection via complete crawl ────────────────────────────────────

describe('PrismaListingRepository.markGone — off-page removal and price-change detection', () => {
  it('detects removal of a listing that was never on page 1 by completing a full crawl', async () => {
    // Simulates: page-1 stable, forced full crawl runs, off-page listing missing
    const db = makeDb(1) // 1 active off-page listing absent from crawl
    const repo = new PrismaListingRepository(db as never)

    // Only page-1 listing keys present; off-page listing 'off-page-key' is absent
    const count = await repo.markGone('src-1', ['page1-key'], { isCompleteCrawl: true })

    // Merged step covers active+possibly_gone absent listings
    expect(db.listing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceId: 'src-1',
        status: { in: ['active', 'possibly_gone'] },
        sourceRecordKey: { notIn: ['page1-key'] },
      }),
      data: expect.objectContaining({ status: 'possibly_gone', missingFromCompleteCount: { increment: 1 } }),
    }))
    expect(count).toBe(1)
  })

  it('does not double-increment a listing newly absent in a complete crawl', async () => {
    // Verifies the merged query prevents the previously-buggy double-increment.
    // In the old implementation: step 2 set active→possibly_gone at count=1,
    // then step 3 matched the now-possibly_gone row and incremented to count=2.
    // With the merged query only one increment happens per run.
    const db = makeDb(1)
    const repo = new PrismaListingRepository(db as never)

    await repo.markGone('src-1', ['seen'], { isCompleteCrawl: true })

    // Count the total number of updateMany calls that INCREMENT missingFromCompleteCount.
    // There should be exactly ONE such call (the merged step), not two.
    // (Reset-to-0 calls are allowed; only increment calls must be deduplicated.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incrementCalls = db.listing.updateMany.mock.calls.filter((call: any[]) => {
      const arg = call[0] as { data: Record<string, unknown> }
      const val = arg.data['missingFromCompleteCount']
      return val !== null && typeof val === 'object' && 'increment' in (val as object)
    })
    expect(incrementCalls.length).toBe(1)
  })
})
