import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as WivwavDb from '@wivwav/db'

vi.mock('@wivwav/db', async (importOriginal) => {
  const actual = await importOriginal<typeof WivwavDb>()
  return { ...actual, getDb: vi.fn() }
})
vi.mock('@wivwav/search', () => ({ syncListings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn(() => ({}) as never) }))

import { getDb, Prisma } from '@wivwav/db'
import { syncListings } from '@wivwav/search'
import { resolveRow, runListingResolveJob, toValidatorInput } from './listing-resolve.js'

function makeListingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    sourceId: 'src-1',
    sourceUrl: 'https://example.com/listing-1',
    buyerUrl: null,
    externalId: 'ext-1',
    stockNumber: null,
    sourceRecordKey: 'rec-1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: null,
    vin: null,
    condition: 'used',
    sellerType: 'dealer',
    priceCents: 4_500_000,
    mileage: 30_000,
    color: null,
    fuelType: null,
    transmission: null,
    conversionType: 'rear_entry',
    conversionManufacturer: 'Driverge',
    floorLoweringInches: null,
    rampType: 'fold_out',
    conversionStatus: 'complete',
    wavFeatures: [],
    wheelchairCapacity: null,
    zip: '89030',
    city: 'North Las Vegas',
    state: 'NV',
    lat: null,
    lng: null,
    dealerName: 'MobilityWorks',
    dealerPhone: null,
    dealerWebsite: null,
    images: [],
    description: null,
    saleStatus: 'active',
    soldAt: null,
    listedAt: new Date('2026-01-01'),
    status: 'active',
    publicationStatus: 'pending',
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  }
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const staleConflictError = new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
  code: 'P2025',
  clientVersion: 'test',
})

describe('toValidatorInput', () => {
  it('maps flat listing fields into the nested validator shape', () => {
    const row = makeListingRow()
    const input = toValidatorInput(row as never)

    expect(input.wav).toEqual({
      conversionType: 'rear_entry',
      conversionManufacturer: 'Driverge',
      floorLoweringInches: null,
      rampType: 'fold_out',
      conversionStatus: 'complete',
      wavFeatures: [],
      wheelchairCapacity: null,
    })
    expect(input.location).toEqual({ zip: '89030', city: 'North Las Vegas', state: 'NV', lat: null, lng: null })
    expect(input.dealer).toEqual({ name: 'MobilityWorks', phone: null, website: null })
    expect(input.sourceRecordKey).toBe('rec-1')
  })
})

describe('resolveRow', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
  })

  it('marks a clean listing eligible and writes the decision', async () => {
    const row = makeListingRow()
    const outcome = await resolveRow(db as never, row as never, undefined)

    expect(outcome).toBe('eligible')
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'l-1', updatedAt: row.updatedAt },
      data: {
        publicationStatus: 'eligible',
        qualityIssueCodes: [],
        qualityCheckedAt: expect.any(Date),
      },
    })
  })

  it('marks a listing with an error-severity issue quarantined', async () => {
    const row = makeListingRow({ sourceRecordKey: 'rec 1 with space' })
    const outcome = await resolveRow(db as never, row as never, undefined)

    expect(outcome).toBe('quarantined')
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicationStatus: 'quarantined',
          qualityIssueCodes: expect.arrayContaining(['contains_space']),
        }),
      }),
    )
  })

  it('skips without throwing when the row changed concurrently (stale optimistic-lock conflict)', async () => {
    db.listing.update.mockRejectedValueOnce(staleConflictError)
    const row = makeListingRow()

    const outcome = await resolveRow(db as never, row as never, undefined)

    expect(outcome).toBe('skipped-stale')
  })

  it('propagates a non-conflict database error instead of swallowing it', async () => {
    db.listing.update.mockRejectedValueOnce(new Error('connection lost'))
    const row = makeListingRow()

    await expect(resolveRow(db as never, row as never, undefined)).rejects.toThrow('connection lost')
  })
})

describe('runListingResolveJob — single listing', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('resolves exactly the listing referenced by listingId and syncs it', async () => {
    const row = makeListingRow()
    db.listing.findUnique.mockResolvedValueOnce(row)

    await runListingResolveJob({ listingId: 'l-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' })

    expect(db.listing.findUnique).toHaveBeenCalledWith({ where: { id: 'l-1', status: { not: 'gone' } } })
    expect(db.listing.update).toHaveBeenCalledTimes(1)
    expect(syncListings).toHaveBeenCalledWith(['l-1'], db, expect.anything())
  })

  it('does nothing when the listing no longer exists or is gone', async () => {
    db.listing.findUnique.mockResolvedValueOnce(null)

    await runListingResolveJob({ listingId: 'gone-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' })

    expect(db.listing.update).not.toHaveBeenCalled()
    expect(syncListings).not.toHaveBeenCalled()
  })

  it('does not sync when the write is skipped as stale', async () => {
    db.listing.findUnique.mockResolvedValueOnce(makeListingRow())
    db.listing.update.mockRejectedValueOnce(staleConflictError)

    await runListingResolveJob({ listingId: 'l-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' })

    expect(syncListings).not.toHaveBeenCalled()
  })

  it('propagates a search-sync failure so the caller (and BullMQ) can retry', async () => {
    db.listing.findUnique.mockResolvedValueOnce(makeListingRow())
    vi.mocked(syncListings).mockRejectedValueOnce(new Error('meilisearch unreachable'))

    await expect(
      runListingResolveJob({ listingId: 'l-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' }),
    ).rejects.toThrow('meilisearch unreachable')
    // The decision was still committed — only the search sync failed. Resolution does
    // not roll back the publication write; a retry re-derives the same decision and
    // retries the sync, which is idempotent.
    expect(db.listing.update).toHaveBeenCalledTimes(1)
  })

  it('lets a resolution failure propagate so BullMQ marks the job retryable/failed', async () => {
    db.listing.findUnique.mockResolvedValueOnce(makeListingRow())
    db.listing.update.mockRejectedValueOnce(new Error('db exploded'))

    await expect(
      runListingResolveJob({ listingId: 'l-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' }),
    ).rejects.toThrow('db exploded')
  })

  it('disconnects from the database even when resolution fails', async () => {
    db.listing.findUnique.mockResolvedValueOnce(makeListingRow())
    db.listing.update.mockRejectedValueOnce(new Error('db exploded'))

    await expect(
      runListingResolveJob({ listingId: 'l-1', observationReference: 'raw-1:2026-01-01T00:00:00.000Z' }),
    ).rejects.toThrow()
    expect(db.$disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('runListingResolveJob — source-scoped fan-out', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('does nothing when no listings for the source are pending', async () => {
    db.listing.findMany.mockResolvedValueOnce([])

    await runListingResolveJob({ sourceId: 'src-1' })

    expect(db.listing.update).not.toHaveBeenCalled()
    expect(db.listing.findMany).toHaveBeenCalledTimes(1)
    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId: 'src-1', publicationStatus: 'pending', status: { not: 'gone' } },
      }),
    )
  })

  it('drains a source backlog spanning multiple bounded batches (fan-out) using a cursor', async () => {
    // BATCH_SIZE is 100 — a batch shorter than that signals the last page and the
    // loop stops without a further fetch. A full-sized first batch forces a second
    // findMany call; the shorter second batch then ends the loop.
    const BATCH_SIZE = 100
    const batch1 = Array.from({ length: BATCH_SIZE }, (_, i) => makeListingRow({ id: `b1-${i}` }))
    const batch2 = [makeListingRow({ id: 'b2-0' })]
    db.listing.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce(batch2)

    await runListingResolveJob({ sourceId: 'src-1' })

    expect(db.listing.findMany).toHaveBeenCalledTimes(2)
    const secondCallArgs = db.listing.findMany.mock.calls[1]![0]
    expect(secondCallArgs).toMatchObject({ skip: 1, cursor: { id: `b1-${BATCH_SIZE - 1}` } })
    expect(db.listing.update).toHaveBeenCalledTimes(BATCH_SIZE + 1)
    // Sync is batched once per page, not once per row.
    expect(syncListings).toHaveBeenCalledTimes(2)
    expect(syncListings).toHaveBeenNthCalledWith(
      1,
      batch1.map((r) => r.id),
      db,
      expect.anything(),
    )
    expect(syncListings).toHaveBeenNthCalledWith(2, ['b2-0'], db, expect.anything())
  })

  it('stops after a single batch shorter than the page size', async () => {
    db.listing.findMany.mockResolvedValueOnce([makeListingRow()])

    await runListingResolveJob({ sourceId: 'src-1' })

    expect(db.listing.findMany).toHaveBeenCalledTimes(1)
    expect(db.listing.update).toHaveBeenCalledTimes(1)
  })

  it('advances the cursor past a listing that loses the optimistic-lock race every time (no livelock)', async () => {
    // A listing that always conflicts must not block the cursor from advancing
    // past it — otherwise it would be re-fetched at the head of every page
    // forever. Put the always-stale row first in a full-sized page so a second
    // findMany call happens, and confirm its cursor is the page's LAST id (not
    // the stuck row), proving the cursor advanced past it.
    const BATCH_SIZE = 100
    const alwaysStale = makeListingRow({ id: 'stuck-1' })
    const rest = Array.from({ length: BATCH_SIZE - 1 }, (_, i) => makeListingRow({ id: `ok-${i}` }))
    db.listing.findMany.mockResolvedValueOnce([alwaysStale, ...rest]).mockResolvedValueOnce([])
    db.listing.update.mockRejectedValueOnce(staleConflictError).mockResolvedValue({})

    await runListingResolveJob({ sourceId: 'src-1' })

    expect(db.listing.findMany).toHaveBeenCalledTimes(2)
    const secondCallArgs = db.listing.findMany.mock.calls[1]![0]
    expect(secondCallArgs).toMatchObject({ skip: 1, cursor: { id: `ok-${BATCH_SIZE - 2}` } })
  })

  it('propagates a mid-batch failure so BullMQ retries the whole source job', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      makeListingRow({ id: 'l-1' }),
      makeListingRow({ id: 'l-2' }),
    ])
    db.listing.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db exploded'))

    await expect(runListingResolveJob({ sourceId: 'src-1' })).rejects.toThrow('db exploded')
    // The first listing's decision was already committed before the failure.
    expect(db.listing.update).toHaveBeenCalledTimes(2)
  })

  it('excludes a stale-skipped listing from the batched sync but still syncs the rest', async () => {
    db.listing.findMany.mockResolvedValueOnce([
      makeListingRow({ id: 'l-1' }),
      makeListingRow({ id: 'l-2' }),
    ]).mockResolvedValueOnce([])
    db.listing.update.mockRejectedValueOnce(staleConflictError).mockResolvedValueOnce({})

    await runListingResolveJob({ sourceId: 'src-1' })

    expect(db.listing.update).toHaveBeenCalledTimes(2)
    expect(syncListings).toHaveBeenCalledTimes(1)
    expect(syncListings).toHaveBeenCalledWith(['l-2'], db, expect.anything())
  })
})
