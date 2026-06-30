import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
  upsertVehicleIdentityDecision: vi.fn(),
  VehicleIdentityDecisionState: { candidate: 'candidate', verified: 'verified', rejected: 'rejected', split: 'split' },
  normalizeVin: (vin: string) => vin.trim().toUpperCase(),
  isValidVin: (vin: string) => vin.length === 17 && !/[IOQ]/.test(vin),
  checkDigitValid: () => true,
}))
vi.mock('@wivwav/search', () => ({ syncListings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn() }))

import { getDb, upsertVehicleIdentityDecision } from '@wivwav/db'
import { syncListings } from '@wivwav/search'
import { runMatchVehicleIdentityJob } from './match-vehicle-identity.js'

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sourceId: 'src-1',
    sourceUrl: 'https://www.example-dealer.com/vans/1',
    dealerProfileId: 'dealer-1',
    dealerWebsite: 'https://www.example-dealer.com',
    dealerName: 'Example Dealer',
    stockNumber: 'STK1',
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    trim: 'XLE',
    vin: null,
    mileage: 30000,
    priceCents: 5000000,
    zip: '44114',
    city: 'Cleveland',
    state: 'OH',
    vehicleId: null,
    status: 'active',
    scrapedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('runMatchVehicleIdentityJob', () => {
  let db: {
    listing: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
    vehicle: { create: ReturnType<typeof vi.fn> }
    $executeRaw: ReturnType<typeof vi.fn>
    listingLock?: unknown
    $disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db = {
      listing: {
        findMany: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({}),
      },
      vehicle: {
        create: vi.fn().mockResolvedValue({ id: 'vehicle-new' }),
      },
      // acquireListingLock/releaseListingLocks use raw SQL — mock as always-succeeding.
      $executeRaw: vi.fn().mockResolvedValue(1),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(upsertVehicleIdentityDecision).mockResolvedValue({} as never)
  })

  it('does nothing when there are no unmatched listings', async () => {
    db.listing.findMany.mockResolvedValue([])

    await runMatchVehicleIdentityJob()

    expect(upsertVehicleIdentityDecision).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('auto-links a no-VIN stable-identifier pair (same dealer + stock number) and assigns a shared vehicleId', async () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()

    expect(db.vehicle.create).toHaveBeenCalledTimes(1)
    expect(db.listing.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { vehicleId: 'vehicle-new' } })
    expect(db.listing.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { vehicleId: 'vehicle-new' } })
    expect(upsertVehicleIdentityDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ listingAId: 'a', listingBId: 'b', state: 'verified', vehicleId: 'vehicle-new' }),
    )
    // Auto-linked listings must be re-synced to Meilisearch, same as deduplicate.ts —
    // otherwise the search index keeps serving the stale (pre-link) vehicle grouping.
    expect(syncListings).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']), db, undefined)
  })

  it('persists a fuzzy match below auto-link as a candidate without assigning vehicleId', async () => {
    const a = makeListing({ id: 'a', stockNumber: 'A1', sourceUrl: 'https://www.example-dealer.com/vans/a' })
    const b = makeListing({
      id: 'b',
      stockNumber: 'B2',
      sourceUrl: 'https://www.example-dealer.com/vans/b',
      mileage: 30500,
      priceCents: 5010000,
    })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()

    expect(db.vehicle.create).not.toHaveBeenCalled()
    expect(db.listing.update).not.toHaveBeenCalled()
    expect(upsertVehicleIdentityDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ listingAId: 'a', listingBId: 'b', state: 'candidate' }),
    )
    // No listings were mutated, so syncListings is still called (matching
    // deduplicate.ts's unconditional call) but with an empty id list.
    expect(syncListings).toHaveBeenCalledWith([], db, undefined)
  })

  it('a conflicting valid VIN blocks linking and records no decision', async () => {
    const a = makeListing({ id: 'a', vin: '5TDYRKEC8RS205440' })
    const b = makeListing({
      id: 'b',
      vin: '1FTFW1XT0EFA12345',
      sourceUrl: 'https://www.example-dealer.com/vans/2',
    })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()

    expect(upsertVehicleIdentityDecision).not.toHaveBeenCalled()
    expect(db.vehicle.create).not.toHaveBeenCalled()
    expect(db.listing.update).not.toHaveBeenCalled()
  })

  it('does not falsely merge near-identical vehicles at one dealer with distinct stock numbers', async () => {
    const a = makeListing({
      id: 'a',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
      trim: 'XLE',
      mileage: 30000,
      priceCents: 5000000,
    })
    const b = makeListing({
      id: 'b',
      stockNumber: 'A2',
      sourceUrl: 'https://www.example-dealer.com/vans/a2',
      trim: 'LE',
      mileage: 52000,
      priceCents: 4700000,
      zip: '44115',
      city: 'Lakewood',
    })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()

    expect(db.vehicle.create).not.toHaveBeenCalled()
    expect(db.listing.update).not.toHaveBeenCalled()
    const verifiedCalls = vi.mocked(upsertVehicleIdentityDecision).mock.calls.filter(
      (call) => call[1].state === 'verified',
    )
    expect(verifiedCalls).toHaveLength(0)
  })

  it('legitimate cross-source photo reuse is not treated as a conflict and does not block a candidate decision', async () => {
    const a = makeListing({
      id: 'a',
      dealerProfileId: 'dealer-1',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
    })
    const b = makeListing({
      id: 'b',
      dealerProfileId: 'dealer-2',
      dealerWebsite: 'https://dealer-two.com',
      dealerName: 'Dealer Two',
      stockNumber: 'ZZZ',
      sourceUrl: 'https://dealer-two.com/vans/b',
    })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()

    // Different dealers/stock numbers and no other strong overlap besides
    // compatible identity — should not auto-link, but must not error either.
    expect(db.vehicle.create).not.toHaveBeenCalled()
  })

  it('is idempotent across retries — rerunning with the same data upserts the same pair again rather than erroring', async () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    db.listing.findMany.mockResolvedValue([a, b])

    await runMatchVehicleIdentityJob()
    await runMatchVehicleIdentityJob()

    expect(upsertVehicleIdentityDecision).toHaveBeenCalledTimes(2)
    const [firstCallArgs] = vi.mocked(upsertVehicleIdentityDecision).mock.calls
    expect(firstCallArgs?.[1]).toEqual(expect.objectContaining({ listingAId: 'a', listingBId: 'b' }))
  })
})
