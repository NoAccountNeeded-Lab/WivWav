import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
}))
vi.mock('@wivwav/search', () => ({
  INDEX_NAME: 'listings',
  toDocument: vi.fn((row: { id: string }) => ({ id: row.id })),
  selectRepresentative: vi.fn((listings: { id: string }[]) => listings[0]!),
}))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn() }))

import { getDb } from '@wivwav/db'
import { selectRepresentative } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { runMeilisearchSyncJob } from './meilisearch-sync.js'

describe('runMeilisearchSyncJob', () => {
  let addDocuments: ReturnType<typeof vi.fn>
  let deleteAllDocuments: ReturnType<typeof vi.fn>
  let waitForTask: ReturnType<typeof vi.fn>
  let getStats: ReturnType<typeof vi.fn>
  let db: {
    $queryRaw: ReturnType<typeof vi.fn>
    listing: { findMany: ReturnType<typeof vi.fn> }
    $disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    addDocuments = vi.fn(async () => ({}))
    deleteAllDocuments = vi.fn(async () => ({ taskUid: 10 }))
    waitForTask = vi.fn(async () => ({ status: 'succeeded', uid: 10 }))
    getStats = vi.fn(async () => ({ numberOfDocuments: 3 }))
    db = {
      $queryRaw: vi.fn(async () => [{ count: 2 }]),
      listing: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 'listing-1', vehicleId: null },
            { id: 'listing-2', vehicleId: null },
            { id: 'listing-3', vehicleId: null },
          ])
          .mockResolvedValueOnce([]),
      },
      $disconnect: vi.fn(async () => undefined),
    }

    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(getMeiliClient).mockReturnValue({
      index: vi.fn(() => ({ addDocuments, deleteAllDocuments, getStats })),
      tasks: { waitForTask },
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
      expect.stringContaining('2 eligible active vehicle group(s) in DB'),
    )
  })

  it('clears stale documents before upserting eligible listing documents', async () => {
    await runMeilisearchSyncJob()

    expect(deleteAllDocuments).toHaveBeenCalledOnce()
    expect(waitForTask).toHaveBeenCalledWith(10, { timeout: 15_000 })
    expect(addDocuments).toHaveBeenCalledWith(
      [{ id: 'listing-1' }, { id: 'listing-2' }, { id: 'listing-3' }],
      { primaryKey: 'id' },
    )
    expect(deleteAllDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      addDocuments.mock.invocationCallOrder[0]!,
    )
    expect(db.listing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'active',
        publicationStatus: 'eligible',
      },
    }))
  })

  it('fails closed when stale document deletion fails', async () => {
    waitForTask.mockResolvedValueOnce({ status: 'failed', uid: 10 })

    await expect(runMeilisearchSyncJob()).rejects.toThrow(
      'Meilisearch clear failed: task 10 ended with status failed',
    )
    expect(addDocuments).not.toHaveBeenCalled()
  })

  it('uploads only one representative per verified vehicle group', async () => {
    const vehicleId = 'vehicle-1'
    db.listing.findMany = vi.fn()
      .mockResolvedValueOnce([
        { id: 'listing-a', vehicleId },
        { id: 'listing-b', vehicleId },
      ])
      .mockResolvedValueOnce([])

    // Mock selectRepresentative to return listing-a as the winner.
    vi.mocked(selectRepresentative).mockReturnValue({ id: 'listing-a', vehicleId } as never)

    await runMeilisearchSyncJob()

    // selectRepresentative must have been called with the group.
    expect(selectRepresentative).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'listing-a' }),
        expect.objectContaining({ id: 'listing-b' }),
      ]),
    )
    // Only the representative document should be upserted.
    expect(addDocuments).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'listing-a' })],
      { primaryKey: 'id' },
    )
  })
})
