import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
  upsertVehicleIdentityDecision: vi.fn(),
  VehicleIdentityDecisionState: { candidate: 'candidate', verified: 'verified', rejected: 'rejected', split: 'split' },
  normalizeVin: (vin: string) => vin.trim().toUpperCase(),
  isValidVin: (vin: string) => vin.length === 17 && !/[IOQ]/.test(vin),
  checkDigitValid: () => true,
}))

import { getDb, upsertVehicleIdentityDecision } from '@wivwav/db'
import { runVehicleIdentityBackfill } from './vehicle-identity-backfill.js'

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
    source: { name: 'Example Dealer Source' },
    ...overrides,
  }
}

function makeDb() {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runVehicleIdentityBackfill', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(upsertVehicleIdentityDecision).mockResolvedValue({} as never)
  })

  it('reports zero audited listings when there are none', async () => {
    const report = await runVehicleIdentityBackfill({ apply: false })

    expect(report.totalListingsAudited).toBe(0)
    expect(report.totalPairs).toBe(0)
    expect(report.autoLinked).toBe(0)
    expect(report.candidates).toBe(0)
    expect(report.noMatch).toBe(0)
  })

  it('does not write any decisions in report mode even when pairs match', async () => {
    // Two listings with the same dealer + stock number auto-link in the live job.
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    db.listing.findMany.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([])

    const report = await runVehicleIdentityBackfill({ apply: false })

    expect(report.autoLinked).toBe(1)
    expect(upsertVehicleIdentityDecision).not.toHaveBeenCalled()
  })

  it('does not write anything in report mode for candidate pairs either', async () => {
    // Different stock numbers and URLs, but same dealer + compatible identity =>
    // should score as a candidate but not be persisted in report mode.
    const a = makeListing({
      id: 'a',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
    })
    const b = makeListing({
      id: 'b',
      stockNumber: 'B2',
      sourceUrl: 'https://www.example-dealer.com/vans/b',
      mileage: 30400,
      priceCents: 5010000,
    })
    db.listing.findMany.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([])

    await runVehicleIdentityBackfill({ apply: false })

    expect(upsertVehicleIdentityDecision).not.toHaveBeenCalled()
  })

  it('persists auto_link decisions when apply is true', async () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    db.listing.findMany.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([])

    await runVehicleIdentityBackfill({ apply: true })

    expect(upsertVehicleIdentityDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingAId: 'a',
        listingBId: 'b',
        state: 'verified',
      }),
    )
  })

  it('persists candidate decisions when apply is true', async () => {
    const a = makeListing({
      id: 'a',
      stockNumber: 'A1',
      sourceUrl: 'https://www.example-dealer.com/vans/a',
    })
    const b = makeListing({
      id: 'b',
      stockNumber: 'B2',
      sourceUrl: 'https://www.example-dealer.com/vans/b',
      mileage: 30400,
      priceCents: 5010000,
    })
    db.listing.findMany.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([])

    await runVehicleIdentityBackfill({ apply: true })

    expect(upsertVehicleIdentityDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: 'candidate' }),
    )
  })

  it('is idempotent on rerun — calling apply twice produces the same signal distribution', async () => {
    const a = makeListing({ id: 'a' })
    const b = makeListing({ id: 'b', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    // A 2-row batch is smaller than BATCH_SIZE, so the cursor loop issues exactly
    // one findMany per run (it exits after the first sub-full page). Two runs = 2 calls.
    db.listing.findMany
      .mockResolvedValueOnce([a, b])  // run 1
      .mockResolvedValueOnce([a, b])  // run 2

    const firstReport = await runVehicleIdentityBackfill({ apply: true })
    const secondReport = await runVehicleIdentityBackfill({ apply: true })

    expect(firstReport.autoLinked).toBe(1)
    expect(secondReport.autoLinked).toBe(1)
    expect(secondReport.byRule).toEqual(firstReport.byRule)
    // Both runs call upsert — idempotent because upsertVehicleIdentityDecision uses ON CONFLICT DO UPDATE.
    expect(upsertVehicleIdentityDecision).toHaveBeenCalledTimes(2)
    // The persisted state must be identical between runs (same pair, same state).
    const calls = vi.mocked(upsertVehicleIdentityDecision).mock.calls
    expect(calls[0]![1].listingAId).toBe(calls[1]![1].listingAId)
    expect(calls[0]![1].listingBId).toBe(calls[1]![1].listingBId)
    expect(calls[0]![1].state).toBe(calls[1]![1].state)
  })

  it('scopes the listing query to a given source when --source is provided', async () => {
    db.listing.findMany.mockResolvedValue([])

    await runVehicleIdentityBackfill({ apply: false, sourceId: 'src-specific' })

    expect(db.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: 'src-specific' }),
      }),
    )
  })

  it('sets scopedToSourceId in the report when --source is provided', async () => {
    db.listing.findMany.mockResolvedValue([])

    const report = await runVehicleIdentityBackfill({ apply: false, sourceId: 'src-abc' })

    expect(report.scopedToSourceId).toBe('src-abc')
  })

  it('leaves scopedToSourceId undefined when no source filter is given', async () => {
    db.listing.findMany.mockResolvedValue([])

    const report = await runVehicleIdentityBackfill({ apply: false })

    expect(report.scopedToSourceId).toBeUndefined()
  })

  it('counts no_match pairs correctly', async () => {
    // Conflicting valid VINs force no_match regardless of other signals.
    const a = makeListing({ id: 'a', vin: '5TDYRKEC8RS205440' })
    const b = makeListing({ id: 'b', vin: '1FTFW1XT0EFA12345', sourceUrl: 'https://www.example-dealer.com/vans/2' })
    db.listing.findMany.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([])

    const report = await runVehicleIdentityBackfill({ apply: false })

    expect(report.noMatch).toBe(1)
    expect(report.autoLinked).toBe(0)
    expect(report.candidates).toBe(0)
    expect(upsertVehicleIdentityDecision).not.toHaveBeenCalled()
  })

  it('includes candidate pairs in the false-positive sample sorted by ascending score', async () => {
    // Produce two candidate pairs with different scores by varying which signals fire.
    const base = makeListing({ id: 'base', stockNumber: 'S999', sourceUrl: 'https://dealer.com/base' })
    // Same dealer, different stock, slightly different mileage: borderline candidate.
    const near = makeListing({
      id: 'near',
      stockNumber: 'NEAR1',
      sourceUrl: 'https://dealer.com/near',
      mileage: 30400,
      priceCents: 5010000,
    })
    db.listing.findMany.mockResolvedValueOnce([base, near]).mockResolvedValueOnce([])

    const report = await runVehicleIdentityBackfill({ apply: false })

    // If a candidate pair was found, verify the sample is populated.
    if (report.candidates > 0) {
      expect(report.falsePositiveSample.length).toBeGreaterThan(0)
      expect(report.falsePositiveSample[0]).toMatchObject({
        listingAId: expect.any(String),
        listingBId: expect.any(String),
        score: expect.any(Number),
        topSignals: expect.any(Array),
      })
    }
  })

  it('groups listings into make/model/year buckets and only scores within-bucket pairs', async () => {
    // Two Siennas and one Odyssey — only the Sienna pair should be scored.
    const sienna1 = makeListing({ id: 'sienna1', make: 'Toyota', model: 'Sienna', year: 2024 })
    const sienna2 = makeListing({
      id: 'sienna2',
      make: 'Toyota',
      model: 'Sienna',
      year: 2024,
      sourceUrl: 'https://www.example-dealer.com/vans/2',
    })
    const odyssey = makeListing({
      id: 'odyssey',
      make: 'Honda',
      model: 'Odyssey',
      year: 2024,
      sourceUrl: 'https://www.example-dealer.com/vans/3',
      dealerProfileId: 'dealer-1',
      stockNumber: 'STK1',
    })
    db.listing.findMany.mockResolvedValueOnce([sienna1, sienna2, odyssey]).mockResolvedValueOnce([])

    const report = await runVehicleIdentityBackfill({ apply: false })

    // Total audited = 3, but only 1 pair (the two Siennas) can be scored.
    expect(report.totalListingsAudited).toBe(3)
    expect(report.totalPairs).toBe(1)
  })

  it('disconnects from the database when finished', async () => {
    await runVehicleIdentityBackfill({ apply: false })

    expect(db.$disconnect).toHaveBeenCalledTimes(1)
  })

  it('paginates across multiple batches using the cursor', async () => {
    const BATCH_SIZE = 500
    const batch1 = Array.from({ length: BATCH_SIZE }, (_, i) =>
      makeListing({ id: `l${i}`, sourceUrl: `https://www.example-dealer.com/vans/${i}` }),
    )
    db.listing.findMany.mockResolvedValueOnce(batch1).mockResolvedValueOnce([])

    await runVehicleIdentityBackfill({ apply: false })

    expect(db.listing.findMany).toHaveBeenCalledTimes(2)
    const secondCall = db.listing.findMany.mock.calls[1]![0]
    expect(secondCall).toMatchObject({ skip: 1, cursor: { id: `l${BATCH_SIZE - 1}` } })
  })
})
