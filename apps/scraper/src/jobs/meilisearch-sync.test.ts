import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
  // `fetchOrderedIdPage` composes its cursor clause with `Prisma.sql`/`Prisma.empty`;
  // `$queryRaw` itself is mocked per-test, so these just need to not throw.
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    empty: { strings: [''], values: [] },
  },
}))
vi.mock('@wivwav/search', () => ({
  INDEX_NAME: 'listings',
  toDocument: vi.fn((row: { id: string }) => ({ id: row.id })),
  selectRepresentative: vi.fn((listings: { id: string }[]) => listings[0]!),
  groupKeyOf: vi.fn((row: { id: string; vehicleId: string | null }) => row.vehicleId ?? row.id),
  configureIndexSettings: vi.fn(async () => undefined),
  indexExists: vi.fn(async () => true),
}))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn() }))

import { getDb } from '@wivwav/db'
import { configureIndexSettings, indexExists, selectRepresentative } from '@wivwav/search'
import { getMeiliClient } from '../lib/meili.js'
import { runMeilisearchSyncJob } from './meilisearch-sync.js'

type IdRow = { id: string; groupKey: string }
type ListingRow = { id: string; vehicleId: string | null }

function idRowsFor(ids: string[], groupKey: string): IdRow[] {
  return ids.map((id) => ({ id, groupKey }))
}

function listingRowsFor(ids: string[], vehicleId: string | null): ListingRow[] {
  return ids.map((id) => ({ id, vehicleId }))
}

describe('runMeilisearchSyncJob', () => {
  let addDocuments: ReturnType<typeof vi.fn>
  let getStats: ReturnType<typeof vi.fn>
  let waitForTask: ReturnType<typeof vi.fn>
  let indexFn: ReturnType<typeof vi.fn>
  let getIndexes: ReturnType<typeof vi.fn>
  let deleteIndexIfExists: ReturnType<typeof vi.fn>
  let swapIndexes: ReturnType<typeof vi.fn>
  let db: {
    $queryRaw: ReturnType<typeof vi.fn>
    listing: { findMany: ReturnType<typeof vi.fn> }
    $disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(configureIndexSettings).mockResolvedValue(undefined)
    vi.mocked(indexExists).mockResolvedValue(true)

    addDocuments = vi.fn(async () => ({ taskUid: 20 }))
    getStats = vi.fn(async () => ({ numberOfDocuments: 3 }))
    waitForTask = vi.fn(async (uid: number) => ({ status: 'succeeded', uid }))
    indexFn = vi.fn(() => ({ addDocuments, getStats }))
    getIndexes = vi.fn(async () => ({ results: [] }))
    deleteIndexIfExists = vi.fn(async () => true)
    swapIndexes = vi.fn(async () => ({ taskUid: 30 }))

    db = {
      // Call order: [0] vehicle-aware count, [1..] one per fetchOrderedIdPage call.
      // These are ungrouped (no vehicleId) listings, so each is its own singleton group
      // keyed by its own id.
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ count: 3 }])
        .mockResolvedValueOnce(['listing-1', 'listing-2', 'listing-3'].map((id) => ({ id, groupKey: id }))),
      listing: {
        findMany: vi.fn().mockResolvedValueOnce(listingRowsFor(['listing-1', 'listing-2', 'listing-3'], null)),
      },
      $disconnect: vi.fn(async () => undefined),
    }

    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(getMeiliClient).mockReturnValue({
      index: indexFn,
      tasks: { waitForTask },
      getIndexes,
      deleteIndexIfExists,
      swapIndexes,
    } as never)
  })

  it('uses vehicle-aware active group count for progress totals', async () => {
    const context = {
      log: vi.fn(async () => undefined),
      updateProgress: vi.fn(async () => undefined),
    }

    await runMeilisearchSyncJob(context as never)

    expect(db.$queryRaw).toHaveBeenCalled()
    expect(context.updateProgress).toHaveBeenCalledWith({
      stage: 'syncing',
      current: 0,
      total: 3,
    })
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('3 eligible active vehicle group(s) in DB'),
    )
  })

  it('reports stage complete with matching counts on a clean rebuild', async () => {
    const context = {
      log: vi.fn(async () => undefined),
      updateProgress: vi.fn(async () => undefined),
    }

    await runMeilisearchSyncJob(context as never)

    expect(context.updateProgress).toHaveBeenCalledWith({
      stage: 'complete',
      current: 3,
      total: 3,
    })
  })

  it('orders and keyset-paginates the full scan by vehicle group key, not by listing id', async () => {
    await runMeilisearchSyncJob()

    const idPageCall = db.$queryRaw.mock.calls[1]!
    const sql = (idPageCall[0] as unknown as string[]).join('')
    expect(sql).toContain('ORDER BY COALESCE("vehicleId", id), id')
    expect(sql).toContain('COALESCE("vehicleId", id) AS "groupKey"')
  })

  it('builds into a freshly created versioned index and swaps it into service atomically', async () => {
    await runMeilisearchSyncJob()

    // The rebuild writes documents into a new, uniquely named index — never
    // clearing or writing directly into the live "listings" index.
    const versionedNames = indexFn.mock.calls.map((call) => call[0] as string)
    expect(versionedNames.every((name) => name.startsWith('listings_v'))).toBe(true)
    expect(vi.mocked(configureIndexSettings)).toHaveBeenCalledWith(expect.anything(), versionedNames[0])

    expect(addDocuments).toHaveBeenCalledWith(
      [{ id: 'listing-1' }, { id: 'listing-2' }, { id: 'listing-3' }],
      { primaryKey: 'id' },
    )

    // Only after a fully validated build does the swap happen, and it swaps
    // the live name with the versioned build target.
    expect(swapIndexes).toHaveBeenCalledWith([{ indexes: ['listings', versionedNames[0]], rename: false }])
    expect(addDocuments.mock.invocationCallOrder[0]).toBeLessThan(swapIndexes.mock.invocationCallOrder[0]!)

    // The pre-swap index (now holding stale content) is cleaned up afterward.
    expect(deleteIndexIfExists).toHaveBeenCalledWith(versionedNames[0])
  })

  it('creates the live index when it does not exist yet, so the first-ever rebuild can still swap', async () => {
    vi.mocked(indexExists).mockResolvedValueOnce(false)

    await runMeilisearchSyncJob()

    expect(vi.mocked(configureIndexSettings)).toHaveBeenCalledWith(expect.anything(), 'listings')
    expect(swapIndexes).toHaveBeenCalled()
  })

  it('removes orphaned versioned indexes left behind by a prior crashed run', async () => {
    getIndexes.mockResolvedValueOnce({
      results: [{ uid: 'listings' }, { uid: 'listings_v1' }, { uid: 'listings_v2' }],
    })

    await runMeilisearchSyncJob()

    expect(deleteIndexIfExists).toHaveBeenCalledWith('listings_v1')
    expect(deleteIndexIfExists).toHaveBeenCalledWith('listings_v2')
    expect(deleteIndexIfExists).not.toHaveBeenCalledWith('listings')
  })

  it('deletes the half-built versioned index instead of swapping when the rebuild fails validation', async () => {
    getStats.mockResolvedValueOnce({ numberOfDocuments: 2 })

    await expect(runMeilisearchSyncJob()).rejects.toThrow(/Count mismatch/)

    expect(swapIndexes).not.toHaveBeenCalled()
    const versionedName = indexFn.mock.calls[0]![0] as string
    expect(deleteIndexIfExists).toHaveBeenCalledWith(versionedName)
  })

  it('fails closed when an addDocuments task does not succeed', async () => {
    waitForTask.mockResolvedValueOnce({ status: 'failed', uid: 20 })

    await expect(runMeilisearchSyncJob()).rejects.toThrow(
      'Meilisearch addDocuments failed: task 20 ended with status failed',
    )
    expect(swapIndexes).not.toHaveBeenCalled()
  })

  it('fails closed and reports blocked when submitted and committed counts do not match the DB group count', async () => {
    getStats.mockResolvedValueOnce({ numberOfDocuments: 2 })

    const context = {
      log: vi.fn(async () => undefined),
      updateProgress: vi.fn(async () => undefined),
    }

    await expect(runMeilisearchSyncJob(context as never)).rejects.toThrow(/Count mismatch/)

    expect(context.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'blocked' }),
    )
    expect(swapIndexes).not.toHaveBeenCalled()
  })

  it('does not crash when every row on a non-final page turns ineligible before the full-row fetch', async () => {
    // Simulates every id from a full (non-final) page vanishing from the eligible set
    // between the id-scan and the follow-up `findMany` re-check — `pending` ends up
    // empty on the non-final-page branch, which must not crash on the tail-group lookup.
    const page1Ids: IdRow[] = Array.from({ length: 1000 }, (_, i) => ({ id: `listing-${i}`, groupKey: `listing-${i}` }))

    db.$queryRaw = vi.fn()
      .mockResolvedValueOnce([{ count: 1000 }])
      .mockResolvedValueOnce(page1Ids)
      .mockResolvedValueOnce([])
    db.listing.findMany = vi.fn().mockResolvedValueOnce([])
    getStats.mockResolvedValueOnce({ numberOfDocuments: 0 })

    await expect(runMeilisearchSyncJob()).rejects.toThrow(/Count mismatch/)
    expect(addDocuments).not.toHaveBeenCalled()
  })

  it('buffers a vehicle group that straddles two pages', async () => {
    const vehicleId = 'vehicle-x'
    // First page is exactly BATCH_SIZE (1000) rows so the sync treats it as non-final.
    // The last listing on the page belongs to vehicle-x; the buffering logic must hold it
    // back and merge it with listing-x2 which arrives on the second page.
    const soloIds = Array.from({ length: 999 }, (_, i) => `listing-solo-${i}`)
    const firstPageIds: IdRow[] = [
      ...soloIds.map((id) => ({ id, groupKey: id })),
      { id: 'listing-x1', groupKey: vehicleId },
    ]
    const secondPageIds: IdRow[] = [{ id: 'listing-x2', groupKey: vehicleId }]

    const firstPageFull: ListingRow[] = [
      ...listingRowsFor(soloIds, null),
      { id: 'listing-x1', vehicleId },
    ]
    const secondPageFull: ListingRow[] = [{ id: 'listing-x2', vehicleId }]

    db.$queryRaw = vi.fn()
      .mockResolvedValueOnce([{ count: 1000 }])
      .mockResolvedValueOnce(firstPageIds)
      .mockResolvedValueOnce(secondPageIds)
    db.listing.findMany = vi.fn()
      .mockResolvedValueOnce(firstPageFull)
      .mockResolvedValueOnce(secondPageFull)
    getStats.mockResolvedValueOnce({ numberOfDocuments: 1000 })

    vi.mocked(selectRepresentative).mockReturnValue({ id: 'listing-x1', vehicleId } as never)

    await runMeilisearchSyncJob()

    // Both group members must have been passed to selectRepresentative together.
    expect(selectRepresentative).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'listing-x1' }),
        expect.objectContaining({ id: 'listing-x2' }),
      ]),
    )

    // Exactly one document for the group should appear across all addDocuments calls.
    const allUpsertedIds = addDocuments.mock.calls.flatMap((call) =>
      (call[0] as { id: string }[]).map((d) => d.id),
    )
    const groupUpserts = allUpsertedIds.filter((id: string) => id === 'listing-x1' || id === 'listing-x2')
    expect(groupUpserts).toHaveLength(1)
  })

  it('buffers a vehicle group whose members span three consecutive pages', async () => {
    // A single group spread across three full pages: listing ids are not contiguous with
    // the group's own ordering in any meaningful sense here (id suffixes are arbitrary),
    // demonstrating that grouping relies on groupKey, not on id proximity or a single
    // page-boundary split.
    const vehicleId = 'vehicle-y'
    const page1Ids: IdRow[] = Array.from({ length: 1000 }, (_, i) => ({ id: `listing-y-${i}`, groupKey: vehicleId }))
    const page2Ids: IdRow[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `listing-y-${1000 + i}`,
      groupKey: vehicleId,
    }))
    const page3Ids: IdRow[] = [{ id: 'listing-y-last', groupKey: vehicleId }]

    db.$queryRaw = vi.fn()
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce(page1Ids)
      .mockResolvedValueOnce(page2Ids)
      .mockResolvedValueOnce(page3Ids)
    db.listing.findMany = vi.fn()
      .mockResolvedValueOnce(listingRowsFor(page1Ids.map((r) => r.id), vehicleId))
      .mockResolvedValueOnce(listingRowsFor(page2Ids.map((r) => r.id), vehicleId))
      .mockResolvedValueOnce(listingRowsFor(page3Ids.map((r) => r.id), vehicleId))
    getStats.mockResolvedValueOnce({ numberOfDocuments: 1 })

    vi.mocked(selectRepresentative).mockImplementation(((group: { id: string }[]) => group[0]!) as never)

    await runMeilisearchSyncJob()

    expect(selectRepresentative).toHaveBeenCalledTimes(1)
    const groupPassed = vi.mocked(selectRepresentative).mock.calls[0]![0] as { id: string }[]
    expect(groupPassed).toHaveLength(2001)
    expect(addDocuments).toHaveBeenCalledTimes(1)
  })

  it('uploads only one representative per verified vehicle group', async () => {
    const vehicleId = 'vehicle-1'
    db.$queryRaw = vi.fn()
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce(idRowsFor(['listing-a', 'listing-b'], vehicleId))
    db.listing.findMany = vi.fn().mockResolvedValueOnce(listingRowsFor(['listing-a', 'listing-b'], vehicleId))
    getStats.mockResolvedValueOnce({ numberOfDocuments: 1 })

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
