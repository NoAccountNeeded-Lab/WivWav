import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runBackfillMissingCountJob } from './backfill-missing-count.js'

describe('runBackfillMissingCountJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports candidates and skips update when no possibly_gone rows have count=0', async () => {
    vi.mocked(getDb).mockReturnValue({
      $queryRaw: vi.fn().mockResolvedValue([]),
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    } as never)

    await runBackfillMissingCountJob()

    const db = vi.mocked(getDb)()
    expect(db.$queryRaw).toHaveBeenCalled()
    expect(db.listing.updateMany).not.toHaveBeenCalled()
  })

  it('reports candidate counts per source before updating', async () => {
    const candidates = [
      { sourceId: 'src-blvd', count: 219 },
      { sourceId: 'src-mw', count: 4 },
    ]
    const db = {
      $queryRaw: vi.fn().mockResolvedValue(candidates),
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 223 }) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)

    const logLines: string[] = []
    await runBackfillMissingCountJob({
      log: vi.fn(async (msg) => { logLines.push(msg) }),
      updateProgress: vi.fn(),
    })

    // Reporting phase must mention candidate counts before updating
    const reportingLine = logLines.find(l => l.includes('Stale possibly_gone candidates'))
    expect(reportingLine).toBeDefined()
    expect(reportingLine).toContain('223 rows')
    expect(reportingLine).toContain('2 source(s)')
  })

  it('updates only possibly_gone rows with missingFromCompleteCount = 0', async () => {
    const candidates = [{ sourceId: 'src-blvd', count: 5 }]
    const db = {
      $queryRaw: vi.fn().mockResolvedValue(candidates),
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 5 }) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)

    await runBackfillMissingCountJob()

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { status: 'possibly_gone', missingFromCompleteCount: 0 },
      data: { missingFromCompleteCount: 1 },
    })
  })

  it('is idempotent — rows already at count >= 1 are not re-updated', async () => {
    // After the first run, count=1 rows no longer match the where clause
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([]), // 0 candidates on second run
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)

    await runBackfillMissingCountJob()

    expect(db.listing.updateMany).not.toHaveBeenCalled()
  })

  it('always disconnects even if an error is thrown', async () => {
    const db = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      listing: { updateMany: vi.fn() },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)

    await expect(runBackfillMissingCountJob()).rejects.toThrow('DB connection failed')
    expect(db.$disconnect).toHaveBeenCalled()
  })
})
