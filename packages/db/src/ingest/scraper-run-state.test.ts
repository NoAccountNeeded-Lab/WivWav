import { describe, it, expect, vi } from 'vitest'
import { completeScraperRun, failScraperRun, startScraperRun } from './scraper-run-state.js'

function makeDb() {
  const db = {
    scraperRun: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'run-1',
        startedAt: new Date('2026-10-04T00:00:00Z'),
        ...data,
      })),
      update: vi.fn().mockResolvedValue({}),
    },
    jobRun: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // Interactive-transaction passthrough: the callback receives this same mock.
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db)),
  }
  return db
}

describe('scraper-run-state dual-write (#1073)', () => {
  describe('startScraperRun', () => {
    it('creates a JobRun row sharing the ScraperRun id so listing upserts satisfy the FK', async () => {
      const db = makeDb()
      const record = await startScraperRun(db as never, 'src-1')

      expect(record).toEqual({ id: 'run-1' })
      expect(db.scraperRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sourceId: 'src-1' }) }),
      )
      expect(db.jobRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'run-1',
            jobType: 'source-scrape',
            sourceId: 'src-1',
          }),
        }),
      )
    })
  })

  describe('completeScraperRun', () => {
    it('marks both the ScraperRun and the JobRun succeeded', async () => {
      const db = makeDb()
      await completeScraperRun(db as never, 'run-1', 10, { listingsNew: 3, listingsUpdated: 2 })

      expect(db.scraperRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ success: true, listingsFound: 10 }),
        }),
      )
      expect(db.jobRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ status: 'succeeded' }),
        }),
      )
    })

    it('does not throw when no JobRun row exists (pre-dual-write run)', async () => {
      const db = makeDb()
      db.jobRun.updateMany.mockResolvedValue({ count: 0 })

      await expect(completeScraperRun(db as never, 'legacy-run', 5)).resolves.toBeUndefined()
    })
  })

  describe('failScraperRun', () => {
    it('marks both the ScraperRun and the JobRun failed with the error', async () => {
      const db = makeDb()
      await failScraperRun(db as never, 'run-1', 'boom')

      expect(db.scraperRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ success: false, errorMessage: 'boom' }),
        }),
      )
      expect(db.jobRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
          data: expect.objectContaining({ status: 'failed', errorMessage: 'boom' }),
        }),
      )
    })

    it('does not throw when no JobRun row exists (pre-dual-write run)', async () => {
      const db = makeDb()
      db.jobRun.updateMany.mockResolvedValue({ count: 0 })

      await expect(failScraperRun(db as never, 'legacy-run', 'boom')).resolves.toBeUndefined()
    })
  })
})
