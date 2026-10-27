import { describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runRawPageCleanupJob } from './rawpage-cleanup.js'

describe('runRawPageCleanupJob', () => {
  it('uses the registry retention defaults without a config service', async () => {
    const deleteMany = vi.fn(async (_args: unknown) => ({ count: 0 }))
    vi.mocked(getDb).mockReturnValue({ rawPage: { deleteMany } } as never)
    const before = Date.now()

    await runRawPageCleanupJob()

    const after = Date.now()
    expect(deleteMany).toHaveBeenCalledTimes(2)
    for (const [index, days] of [7, 30].entries()) {
      const call = deleteMany.mock.calls[index]![0] as { where: { scrapedAt: { lt: Date } } }
      const cutoff = call.where.scrapedAt.lt.getTime()
      const duration = days * 24 * 60 * 60 * 1000
      expect(cutoff).toBeGreaterThanOrEqual(before - duration)
      expect(cutoff).toBeLessThanOrEqual(after - duration)
    }
  })
})
