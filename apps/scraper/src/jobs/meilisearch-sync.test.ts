import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
}))
vi.mock('@wivwav/search', () => ({
  INDEX_NAME: 'listings',
  toDocument: vi.fn((row: { id: string }) => ({ id: row.id })),
}))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn() }))

import { getDb } from '@wivwav/db'
import { getMeiliClient } from '../lib/meili.js'
import { runMeilisearchSyncJob } from './meilisearch-sync.js'

describe('runMeilisearchSyncJob', () => {
  let addDocuments: ReturnType<typeof vi.fn>
  let getStats: ReturnType<typeof vi.fn>
  let db: {
    $queryRaw: ReturnType<typeof vi.fn>
    listing: { findMany: ReturnType<typeof vi.fn> }
    $disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    addDocuments = vi.fn(async () => ({}))
    getStats = vi.fn(async () => ({ numberOfDocuments: 3 }))
    db = {
      $queryRaw: vi.fn(async () => [{ count: 2 }]),
      listing: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'listing-1' }, { id: 'listing-2' }, { id: 'listing-3' }])
          .mockResolvedValueOnce([]),
      },
      $disconnect: vi.fn(async () => undefined),
    }

    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(getMeiliClient).mockReturnValue({
      index: vi.fn(() => ({ addDocuments, getStats })),
    } as never)
  })

  it('uses vehicle-aware active group count for progress totals', async () => {
    const context = {
      log: vi.fn(async () => undefined),
      updateProgress: vi.fn(async () => undefined),
    }

    await runMeilisearchSyncJob(context as never)

    expect(db.$queryRaw).toHaveBeenCalledOnce()
    expect(context.updateProgress).toHaveBeenCalledWith({
      stage: 'syncing',
      current: 0,
      total: 2,
    })
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('2 active vehicle group(s) in DB'),
    )
  })

  it('still upserts every listing document during a full sync', async () => {
    await runMeilisearchSyncJob()

    expect(addDocuments).toHaveBeenCalledWith(
      [{ id: 'listing-1' }, { id: 'listing-2' }, { id: 'listing-3' }],
      { primaryKey: 'id' },
    )
  })
})
