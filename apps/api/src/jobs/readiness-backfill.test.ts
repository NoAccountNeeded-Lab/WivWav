import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runReadinessBackfill } from './readiness-backfill.js'

const scraped = new Date('2026-01-01')

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    detailScrapedAt: scraped,
    detailStaleAt: null,
    qualityCheckedAt: new Date('2026-01-02'),
    publicationStatus: 'eligible',
    images: ['a.jpg'],
    vin: null,
    vehicleModelId: null,
    conversionType: 'rear_entry',
    city: 'Reno',
    ...overrides,
  }
}

function makeDb(pages: unknown[][]) {
  const findMany = vi.fn()
  for (const page of pages) findMany.mockResolvedValueOnce(page)
  findMany.mockResolvedValue([])
  const updateMany = vi.fn((args: unknown) => ({ args, count: 1 }))
  return {
    listing: { findMany, updateMany },
    $transaction: vi.fn(async (ops: Array<{ count: number }>) => ops.map((o) => ({ count: o.count }))),
  }
}

describe('runReadinessBackfill', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => vi.clearAllMocks())

  it('writes blockers and readinessComputedAt, never publicationStatus', async () => {
    db = makeDb([[row('ready'), row('nodetail', { detailScrapedAt: null, publicationStatus: 'pending' })]])
    vi.mocked(getDb).mockReturnValue(db as never)

    const result = await runReadinessBackfill()

    expect(result).toEqual({ updated: 2 })
    const calls = db.listing.updateMany.mock.calls.map((c) => c[0] as { where: unknown; data: Record<string, unknown> })
    expect(calls[0]!.data['readinessBlockers']).toEqual([])
    expect(calls[1]!.data['readinessBlockers']).toEqual(['detail_not_crawled', 'not_validated_after_detail'])
    for (const c of calls) {
      expect(c.data['readinessComputedAt']).toBeInstanceOf(Date)
      expect(c.data).not.toHaveProperty('publicationStatus')
      expect(c.where).toMatchObject({ readinessComputedAt: null })
    }
  })

  it('selects only rows still missing readiness, so a re-run is a no-op', async () => {
    db = makeDb([])
    vi.mocked(getDb).mockReturnValue(db as never)

    expect(await runReadinessBackfill()).toEqual({ updated: 0 })
    expect(db.listing.findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: 'active', readinessComputedAt: null },
    })
    expect(db.listing.updateMany).not.toHaveBeenCalled()
  })

  it('pages by id cursor in bounded batches', async () => {
    const full = Array.from({ length: 200 }, (_, i) => row(`r${i}`))
    db = makeDb([full, [row('last')]])
    vi.mocked(getDb).mockReturnValue(db as never)

    const result = await runReadinessBackfill()

    expect(result.updated).toBe(201)
    expect(db.listing.findMany).toHaveBeenCalledTimes(2)
    expect(db.listing.findMany.mock.calls[0]![0]).toMatchObject({ take: 200 })
    expect(db.listing.findMany.mock.calls[1]![0]).toMatchObject({ skip: 1, cursor: { id: 'r199' } })
  })
})
