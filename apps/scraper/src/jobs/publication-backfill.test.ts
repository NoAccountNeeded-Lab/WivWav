import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runBackfill } from './publication-backfill.js'

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
    source: { name: 'MobilityWorks' },
    ...overrides,
  }
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('runBackfill', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('reports zero audited listings when there are none', async () => {
    const report = await runBackfill({ apply: false })
    expect(report.totalAudited).toBe(0)
    expect(report.eligible).toBe(0)
    expect(report.quarantined).toBe(0)
  })

  it('classifies a clean listing as eligible and does not write in report mode', async () => {
    db.listing.findMany.mockResolvedValueOnce([makeListingRow()]).mockResolvedValueOnce([])

    const report = await runBackfill({ apply: false })

    expect(report.totalAudited).toBe(1)
    expect(report.eligible).toBe(1)
    expect(report.quarantined).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('classifies a listing with an error-severity issue as quarantined', async () => {
    db.listing.findMany
      .mockResolvedValueOnce([makeListingRow({ sourceRecordKey: 'rec 1 with space' })])
      .mockResolvedValueOnce([])

    const report = await runBackfill({ apply: false })

    expect(report.quarantined).toBe(1)
    expect(report.eligible).toBe(0)
    expect(report.issuesByRule['contains_space']).toBe(1)
  })

  it('breaks down quarantine counts by source', async () => {
    db.listing.findMany
      .mockResolvedValueOnce([
        makeListingRow({ id: 'l-1', sourceRecordKey: 'bad key', source: { name: 'SourceA' } }),
        makeListingRow({ id: 'l-2', source: { name: 'SourceB' } }),
      ])
      .mockResolvedValueOnce([])

    const report = await runBackfill({ apply: false })

    expect(report.bySource['SourceA']).toEqual({ audited: 1, quarantined: 1 })
    expect(report.bySource['SourceB']).toEqual({ audited: 1, quarantined: 0 })
  })

  it('writes the decision via a transaction when apply is true', async () => {
    db.listing.findMany
      .mockResolvedValueOnce([makeListingRow({ sourceRecordKey: 'bad key' })])
      .mockResolvedValueOnce([])

    await runBackfill({ apply: true })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: {
        publicationStatus: 'quarantined',
        qualityIssueCodes: expect.arrayContaining(['contains_space']),
        qualityCheckedAt: expect.any(Date),
      },
    })
  })

  it('does not write anything in report mode even for quarantined listings', async () => {
    db.listing.findMany
      .mockResolvedValueOnce([makeListingRow({ sourceRecordKey: 'bad key' })])
      .mockResolvedValueOnce([])

    await runBackfill({ apply: false })

    expect(db.listing.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('scopes the audit to a single source when sourceId is provided', async () => {
    db.listing.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runBackfill({ apply: false, sourceId: 'src-1' })

    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'active', sourceId: 'src-1' }) }),
    )
  })

  it('paginates across multiple batches using the cursor when a batch is full-sized', async () => {
    // BATCH_SIZE is 500 — a batch shorter than that signals the last page and the
    // loop stops without a second fetch. To exercise pagination, return exactly
    // BATCH_SIZE rows on the first call so the loop requests a second page.
    const BATCH_SIZE = 500
    const batch1 = Array.from({ length: BATCH_SIZE }, (_, i) => makeListingRow({ id: `b1-${i}` }))
    db.listing.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce([])

    await runBackfill({ apply: false })

    expect(db.listing.findMany).toHaveBeenCalledTimes(2)
    const secondCallArgs = db.listing.findMany.mock.calls[1]![0]
    expect(secondCallArgs).toMatchObject({ skip: 1, cursor: { id: `b1-${BATCH_SIZE - 1}` } })
  })

  it('disconnects from the database when finished', async () => {
    await runBackfill({ apply: false })
    expect(db.$disconnect).toHaveBeenCalledTimes(1)
  })
})
