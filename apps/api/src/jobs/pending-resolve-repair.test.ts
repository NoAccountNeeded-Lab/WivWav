import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@wivwav/db'

vi.mock('./listing-resolve.js', () => ({ resolveRow: vi.fn() }))
import { resolveRow } from './listing-resolve.js'
import { parseRepairArgs, repairPendingListings } from './pending-resolve-repair.js'

function makeDb(rows: Array<{ id: string }>) {
  return {
    listing: {
      count: vi.fn().mockResolvedValue(rows.length),
      findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
    },
  } as unknown as PrismaClient
}

describe('repairPendingListings', () => {
  it('dry run only counts stuck pending rows with detail and resolves nothing', async () => {
    const db = makeDb([{ id: 'a' }, { id: 'b' }])
    const result = await repairPendingListings(db, { apply: false })
    expect(result.found).toBe(2)
    expect(resolveRow).not.toHaveBeenCalled()
    expect(db.listing.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        publicationStatus: 'pending',
        detailScrapedAt: { not: null },
      }),
    })
  })

  it('apply resolves each stuck row and tallies outcomes', async () => {
    vi.mocked(resolveRow)
      .mockResolvedValueOnce('eligible')
      .mockResolvedValueOnce('quarantined')
      .mockResolvedValueOnce('skipped-stale')
    const db = makeDb([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const result = await repairPendingListings(db, { apply: true })
    expect(result).toEqual({ found: 3, eligible: 1, quarantined: 1, skippedStale: 1 })
  })

  it('apply honours the limit', async () => {
    vi.mocked(resolveRow).mockResolvedValue('eligible')
    const db = makeDb([{ id: 'a' }])
    await repairPendingListings(db, { apply: true, limit: 1 })
    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
  })
})

describe('parseRepairArgs', () => {
  it('defaults to a dry run with no limit', () => {
    expect(parseRepairArgs([])).toEqual({ apply: false, delayMs: 200 })
  })
  it('parses valid flags', () => {
    expect(parseRepairArgs(['--apply', '--limit', '25', '--delay-ms', '0'])).toEqual({
      apply: true,
      limit: 25,
      delayMs: 0,
    })
  })
  it.each([
    [['--apply', '--limit']],
    [['--apply', '--limit', 'abc']],
    [['--apply', '--limit', '10x']],
    [['--apply', '--limit', '-5']],
    [['--apply', '--limit', '1.5']],
    [['--apply', '--limit', '0']],
    [['--apply', '--delay-ms', '-1']],
    [['--apply', '--limt', '5']],
  ])('rejects %j', (argv) => {
    expect(() => parseRepairArgs(argv)).toThrow()
  })
})
