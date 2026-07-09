import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))
vi.mock('@wivwav/search', () => ({ syncListings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn(() => ({})) }))

import { getDb } from '@wivwav/db'
import { syncListings } from '@wivwav/search'
import { runSearchIndexerPollJob } from './search-indexer-poll.js'

interface Row {
  id: string
  updatedAt: Date
}

function makeDb() {
  const checkpoints = new Map<string, { id: string; lastUpdatedAt: Date; lastId: string }>()
  return {
    $queryRaw: vi.fn<(...args: unknown[]) => Promise<Row[]>>().mockResolvedValue([]),
    searchIndexerCheckpoint: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => checkpoints.get(where.id) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: { id: string; lastUpdatedAt: Date; lastId: string }; update: { lastUpdatedAt: Date; lastId: string } }) => {
        const existing = checkpoints.get(where.id)
        const row = existing ? { ...existing, ...update } : create
        checkpoints.set(where.id, row)
        return row
      }),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
    __checkpoints: checkpoints,
  }
}

describe('runSearchIndexerPollJob', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('does nothing and does not advance the checkpoint when no rows changed', async () => {
    db.$queryRaw.mockResolvedValueOnce([])

    await runSearchIndexerPollJob()

    expect(syncListings).not.toHaveBeenCalled()
    expect(db.searchIndexerCheckpoint.upsert).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('starts from epoch when no checkpoint row exists yet', async () => {
    db.$queryRaw.mockResolvedValueOnce([])

    await runSearchIndexerPollJob()

    const [sql, ...params] = db.$queryRaw.mock.calls[0]!
    void sql
    // First bound parameter is the checkpoint's lastUpdatedAt (epoch).
    expect((params[0] as Date).getTime()).toBe(0)
    expect(params[1]).toBe('')
  })

  it('syncs a touched batch and advances the checkpoint to the last row after sync succeeds', async () => {
    const rows: Row[] = [
      { id: 'l-1', updatedAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'l-2', updatedAt: new Date('2026-01-01T00:00:01Z') },
    ]
    db.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([])

    await runSearchIndexerPollJob()

    expect(syncListings).toHaveBeenCalledWith(['l-1', 'l-2'], db, expect.anything())
    expect(db.searchIndexerCheckpoint.upsert).toHaveBeenCalledTimes(1)
    const checkpoint = db.__checkpoints.get('listings')
    expect(checkpoint).toMatchObject({ lastId: 'l-2' })
    expect(checkpoint?.lastUpdatedAt).toEqual(rows[1]!.updatedAt)
  })

  it('does not advance the checkpoint when syncListings fails, so the batch replays next run', async () => {
    const rows: Row[] = [{ id: 'l-1', updatedAt: new Date('2026-01-01T00:00:00Z') }]
    db.$queryRaw.mockResolvedValueOnce(rows)
    vi.mocked(syncListings).mockRejectedValueOnce(new Error('Meili down'))

    await expect(runSearchIndexerPollJob()).rejects.toThrow('Meili down')

    expect(db.searchIndexerCheckpoint.upsert).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('pages through multiple full batches in a single run, advancing the checkpoint after each', async () => {
    const batch1: Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: `l-${String(i).padStart(4, '0')}`,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }))
    const batch2: Row[] = [{ id: 'l-final', updatedAt: new Date('2026-01-01T00:00:01Z') }]
    db.$queryRaw.mockResolvedValueOnce(batch1).mockResolvedValueOnce(batch2).mockResolvedValueOnce([])

    await runSearchIndexerPollJob()

    expect(syncListings).toHaveBeenCalledTimes(2)
    expect(db.searchIndexerCheckpoint.upsert).toHaveBeenCalledTimes(2)
    expect(db.__checkpoints.get('listings')).toMatchObject({ lastId: 'l-final' })
  })

  it('resumes from the stored checkpoint on the next run', async () => {
    db.__checkpoints.set('listings', {
      id: 'listings',
      lastUpdatedAt: new Date('2026-01-01T00:00:05Z'),
      lastId: 'l-9',
    })
    db.$queryRaw.mockResolvedValueOnce([])

    await runSearchIndexerPollJob()

    const [, ...params] = db.$queryRaw.mock.calls[0]!
    expect((params[0] as Date).toISOString()).toBe('2026-01-01T00:00:05.000Z')
    expect(params[1]).toBe('l-9')
  })
})
