import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runListingObservationCleanupJob } from './listing-observation-cleanup.js'

function makeDb(rows: Array<Array<{ id: string }>>) {
  const findMany = vi.fn()
  for (const batch of rows) findMany.mockResolvedValueOnce(batch)
  return {
    listingObservation: {
      findMany,
      deleteMany: vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({
        count: where.id.in.length,
      })),
    },
  }
}

describe('runListingObservationCleanupJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects only observations older than the retention cutoff and deletes their IDs', async () => {
    const db = makeDb([[{ id: 'old-1' }], []])
    vi.mocked(getDb).mockReturnValue(db as never)

    await runListingObservationCleanupJob()

    expect(db.listingObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { observedAt: { lt: expect.any(Date) } },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      take: 500,
    }))
    expect(db.listingObservation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1'] } } })
  })

  it('bounds a run at 20 batches when the backlog does not shrink', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, index) => ({ id: `old-${index}` }))
    const db = makeDb([])
    db.listingObservation.findMany.mockResolvedValue(fullBatch)
    vi.mocked(getDb).mockReturnValue(db as never)

    await runListingObservationCleanupJob()

    expect(db.listingObservation.findMany).toHaveBeenCalledTimes(20)
    expect(db.listingObservation.deleteMany).toHaveBeenCalledTimes(20)
    expect(db.listingObservation.deleteMany).toHaveBeenLastCalledWith({
      where: { id: { in: fullBatch.map((row) => row.id) } },
    })
  })
})
