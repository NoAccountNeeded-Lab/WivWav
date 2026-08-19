import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module before importing the job
vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
  findOrCreateVehicle: vi.fn(async () => ({ id: 'vehicle-1' })),
  isValidVin: vi.fn((vin: string) => vin.length === 17),
  checkDigitValid: vi.fn(() => true),
  normalizeVin: vi.fn((vin: string) => vin.trim().toUpperCase()),
}))

import { checkDigitValid, findOrCreateVehicle, getDb, isValidVin } from '@wivwav/db'
import { runDeduplicateJob } from './deduplicate.js'

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-1',
    sourceId: 'src-1',
    sourceUrl: 'http://example.com/1',
    buyerUrl: 'http://example.com/1',
    externalId: null,
    make: 'Toyota',
    model: 'Sienna',
    year: 2022,
    trim: null,
    vin: '1ABCDEF',
    condition: 'used',
    sellerType: 'dealer',
    priceCents: null,
    mileage: null,
    color: null,
    fuelType: null,
    transmission: null,
    conversionType: 'unknown',
    conversionManufacturer: null,
    floorLoweringInches: null,
    rampType: 'none',
    conversionStatus: 'unknown',
    wavFeatures: [],
    wheelchairCapacity: null,
    zip: null,
    city: null,
    state: null,
    lat: null,
    lng: null,
    dealerName: null,
    dealerPhone: null,
    dealerWebsite: null,
    images: [],
    description: null,
    isDuplicate: false,
    canonicalId: null,
    processingLockedAt: null,
    listedAt: new Date(),
    updatedAt: new Date(),
    scrapedAt: new Date(),
    detailScrapedAt: null,
    ...overrides,
  }
}

describe('runDeduplicateJob', () => {
  let db: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    listing: {
      findMany: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      updateMany: ReturnType<typeof vi.fn>
    }
    $disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db = {
      $queryRaw: vi.fn(),
      // acquireListingLock uses $executeRaw; return 1 to simulate successful lock
      $executeRaw: vi.fn().mockResolvedValue(1),
      listing: {
        findMany: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        // releaseListingLocks uses updateMany to clear processingLockedAt
        updateMany: vi.fn().mockResolvedValue({}),
      },
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(findOrCreateVehicle).mockResolvedValue({ id: 'vehicle-1' } as never)
  })

  it('does nothing when no cross-source VIN duplicates exist', async () => {
    db.$queryRaw.mockResolvedValue([])

    const stats = await runDeduplicateJob()

    expect(db.listing.update).not.toHaveBeenCalled()
    expect(stats).toEqual({ succeededCount: 0, failedCount: 0 })
  })

  it('assigns the same vehicleId to every listing in a cross-source VIN group', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const complete = makeListing({
      id: 'list-complete',
      sourceId: 'src-1',
      vin,
      priceCents: 4500000,
      mileage: 32000,
      city: 'Austin',
      state: 'TX',
      description: 'Great WAV',
    })
    const sparse = makeListing({
      id: 'list-sparse',
      sourceId: 'src-2',
      vin,
      scrapedAt: new Date('2026-01-01'),
    })

    db.listing.findMany.mockResolvedValue([sparse, complete])

    const stats = await runDeduplicateJob()

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'list-complete' },
      data: { vehicleId: 'vehicle-1' },
    })
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'list-sparse' },
      data: { vehicleId: 'vehicle-1' },
    })
    // One VIN group linked (this run's unit of work), regardless of how many
    // listings that group touched.
    expect(stats).toEqual({ succeededCount: 1, failedCount: 0 })
  })

  it('assigns the same vehicleId to every listing in a same-source VIN group', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const first = makeListing({
      id: 'list-first',
      sourceId: 'src-1',
      vin,
      priceCents: 4500000,
      mileage: 32000,
      city: 'Austin',
      state: 'TX',
      description: 'Great WAV',
    })
    const second = makeListing({
      id: 'list-second',
      sourceId: 'src-1',
      vin,
      scrapedAt: new Date('2026-01-01'),
    })

    db.listing.findMany.mockResolvedValue([second, first])

    await runDeduplicateJob()

    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'list-first' },
      data: { vehicleId: 'vehicle-1' },
    })
    expect(db.listing.update).toHaveBeenCalledWith({
      where: { id: 'list-second' },
      data: { vehicleId: 'vehicle-1' },
    })
  })

  it('does not group listings sharing a structurally invalid VIN', async () => {
    const vin = 'BADVIN'
    db.$queryRaw.mockResolvedValue([{ vin }])
    vi.mocked(isValidVin).mockReturnValueOnce(false)

    const a = makeListing({ id: 'list-a', sourceId: 'src-1', vin })
    const b = makeListing({ id: 'list-b', sourceId: 'src-1', vin })
    db.listing.findMany.mockResolvedValue([a, b])

    await runDeduplicateJob()

    expect(db.listing.findMany).not.toHaveBeenCalled()
    expect(db.listing.update).not.toHaveBeenCalled()
  })

  it('does not group listings sharing a VIN that fails the check-digit algorithm', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])
    vi.mocked(checkDigitValid).mockReturnValueOnce(false)

    const a = makeListing({ id: 'list-a', sourceId: 'src-1', vin })
    const b = makeListing({ id: 'list-b', sourceId: 'src-2', vin })
    db.listing.findMany.mockResolvedValue([a, b])

    await runDeduplicateJob()

    expect(db.listing.findMany).not.toHaveBeenCalled()
    expect(db.listing.update).not.toHaveBeenCalled()
  })

  it('uses the most complete listing as the vehicle identity seed', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const complete = makeListing({
      id: 'list-complete',
      sourceId: 'src-1',
      vin,
      priceCents: 4500000,
      mileage: 32000,
      city: 'Austin',
      state: 'TX',
      description: 'Great WAV',
      scrapedAt: new Date('2026-01-02'),
      vehicleModelId: 'model-1',
    })
    const sparse = makeListing({ id: 'list-sparse', sourceId: 'src-2', vin, scrapedAt: new Date('2026-01-01') })

    db.listing.findMany.mockResolvedValue([sparse, complete])

    await runDeduplicateJob()

    expect(findOrCreateVehicle).toHaveBeenCalledWith(db, {
      vin,
      make: 'Toyota',
      model: 'Sienna',
      year: 2022,
      trim: null,
      vehicleModelId: 'model-1',
      observedAt: new Date('2026-01-02'),
    })
  })

  it('does not write legacy duplicate fields as the source of truth', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const withImages = makeListing({ id: 'list-images', sourceId: 'src-1', vin, images: ['a.jpg', 'b.jpg'] })
    const noImages = makeListing({ id: 'list-no-images', sourceId: 'src-2', vin, images: [] })

    db.listing.findMany.mockResolvedValue([noImages, withImages])

    await runDeduplicateJob()

    for (const call of db.listing.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('isDuplicate')
      expect(call[0].data).not.toHaveProperty('canonicalId')
    }
  })

  it('skips a VIN group entirely when a listing in the group is locked by another job', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const locked = makeListing({ id: 'list-locked', sourceId: 'src-1', vin })
    const other = makeListing({ id: 'list-other', sourceId: 'src-2', vin })

    db.listing.findMany.mockResolvedValue([locked, other])

    // First call (list-locked) returns 0 — lock not acquired
    db.$executeRaw.mockResolvedValueOnce(0)

    const stats = await runDeduplicateJob()

    // No update calls — the group was skipped
    expect(db.listing.update).not.toHaveBeenCalled()
    expect(stats).toEqual({ succeededCount: 0, failedCount: 1 })
  })

  it('releases partially acquired locks when a later listing in the group is locked', async () => {
    const vin = '1FMJK1HT0MEA12345'
    db.$queryRaw.mockResolvedValue([{ vin }])

    const first = makeListing({ id: 'list-first', sourceId: 'src-1', vin })
    const second = makeListing({ id: 'list-second', sourceId: 'src-2', vin })
    const third = makeListing({ id: 'list-third', sourceId: 'src-3', vin })

    db.listing.findMany.mockResolvedValue([first, second, third])

    // first and second locks acquired, third fails
    db.$executeRaw
      .mockResolvedValueOnce(1) // first — acquired
      .mockResolvedValueOnce(1) // second — acquired
      .mockResolvedValueOnce(0) // third — already locked

    await runDeduplicateJob()

    // Group skipped — no canonical/duplicate updates
    expect(db.listing.update).not.toHaveBeenCalled()

    // Partially acquired locks (first + second) must be released
    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['list-first', 'list-second'] } },
      data: { processingLockedAt: null },
    })
  })
})
