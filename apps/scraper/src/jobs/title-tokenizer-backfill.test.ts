import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runBackfill, reconstructModelTrim } from './title-tokenizer-backfill.js'

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('reconstructModelTrim', () => {
  it('reconstructs "Town & Country" from truncated model/trim', () => {
    expect(reconstructModelTrim('Town', '& Country Touring')).toEqual({
      model: 'Town & Country',
      trim: 'Touring',
    })
  })

  it('reconstructs "Town and Country" from truncated model/trim', () => {
    expect(reconstructModelTrim('Town', 'and Country LX')).toEqual({
      model: 'Town and Country',
      trim: 'LX',
    })
  })

  it('reconstructs "Grand Caravan" from truncated model/trim', () => {
    expect(reconstructModelTrim('Grand', 'Caravan SXT')).toEqual({
      model: 'Grand Caravan',
      trim: 'SXT',
    })
  })

  it('reconstructs with a null resulting trim when there is nothing left over', () => {
    expect(reconstructModelTrim('Grand', 'Caravan')).toEqual({
      model: 'Grand Caravan',
      trim: null,
    })
  })

  it('returns null when trim is null and there is nothing to reconstruct from', () => {
    expect(reconstructModelTrim('Grand', null)).toBeNull()
  })

  it('returns null for a further-mangled fragment that does not match a known multi-word model', () => {
    // "Town" + "& C Touring" — the "Country" portion was already lost upstream
    // (a separate, unrelated mid-title truncation bug); cannot be repaired
    // from stored data alone.
    expect(reconstructModelTrim('Town', '& C Touring')).toBeNull()
  })
})

describe('runBackfill', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('reports zero candidates when there are none', async () => {
    const report = await runBackfill({ apply: false })
    expect(report.totalCandidates).toBe(0)
    expect(report.corrected.total).toBe(0)
    expect(report.unresolved.total).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('queries for the known truncated first-tokens, case-insensitively', async () => {
    await runBackfill({ apply: false })
    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { model: { in: expect.arrayContaining(['TOWN', 'GRAND']), mode: 'insensitive' } },
      }),
    )
  })

  it('corrects a "Town & Country" row and does not write in report mode', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      { id: 'l-1', sourceId: 'blvd', model: 'Town', trim: '& Country Touring', source: { name: 'BLVD' } },
    ])

    const report = await runBackfill({ apply: false })

    expect(report.totalCandidates).toBe(1)
    expect(report.corrected.total).toBe(1)
    expect(report.corrected.bySource['BLVD']).toBe(1)
    expect(report.corrected.samples[0]).toEqual({
      id: 'l-1',
      sourceId: 'blvd',
      before: { model: 'Town', trim: '& Country Touring' },
      after: { model: 'Town & Country', trim: 'Touring' },
    })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('corrects a "Grand Caravan" row when apply is true', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      { id: 'l-2', sourceId: 'mobilityworks', model: 'Grand', trim: 'Caravan SXT', source: { name: 'MobilityWorks' } },
    ])

    await runBackfill({ apply: true })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'l-2' },
      data: { model: 'Grand Caravan', trim: 'SXT', publicationStatus: 'pending' },
    })
  })

  it('reports an unresolved row without writing it, even in apply mode', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      { id: 'l-3', sourceId: 'blvd', model: 'Town', trim: '& C', source: { name: 'BLVD' } },
    ])

    const report = await runBackfill({ apply: true })

    expect(report.unresolved.total).toBe(1)
    expect(report.unresolved.bySource['BLVD']).toBe(1)
    expect(report.unresolved.samples[0]).toEqual({ id: 'l-3', sourceId: 'blvd', model: 'Town', trim: '& C' })
    expect(db.listing.update).not.toHaveBeenCalled()
  })

  it('tallies a mix of corrected and unresolved rows across sources', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      { id: 'l-1', sourceId: 'blvd', model: 'Town', trim: '& Country Touring', source: { name: 'BLVD' } },
      { id: 'l-2', sourceId: 'mobilityworks', model: 'Grand', trim: 'Caravan SXT', source: { name: 'MobilityWorks' } },
      { id: 'l-3', sourceId: 'blvd', model: 'Town', trim: '& C', source: { name: 'BLVD' } },
    ])

    const report = await runBackfill({ apply: false })

    expect(report.totalCandidates).toBe(3)
    expect(report.corrected.total).toBe(2)
    expect(report.unresolved.total).toBe(1)
  })
})
