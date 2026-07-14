import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaMarketRepository } from './market-repository.js'
import { closeIntegrationDb, createListing, createSource, integrationDb, resetIntegrationDb } from '../test-support/integration-db.js'

// Exercises the $queryRaw paths (getPricingStats, getPopular) against a real,
// migrated Postgres — the mocked-PrismaClient unit test never verifies that
// the raw percentile/aggregate SQL actually computes correct numbers (#599).
describe('PrismaMarketRepository (integration)', () => {
  const db = integrationDb()
  const repo = new PrismaMarketRepository(db)

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  describe('getPricingStats', () => {
    it('computes count and median price for matching eligible listings', async () => {
      const source = await createSource(db)
      await createListing(db, source.id, { make: 'Toyota', model: 'Sienna', year: 2020, priceCents: 10_000_00 })
      await createListing(db, source.id, { make: 'Toyota', model: 'Sienna', year: 2020, priceCents: 20_000_00 })
      await createListing(db, source.id, { make: 'Toyota', model: 'Sienna', year: 2020, priceCents: 30_000_00 })
      // Non-matching make must be excluded.
      await createListing(db, source.id, { make: 'Honda', model: 'Odyssey', year: 2020, priceCents: 15_000_00 })

      const stats = await repo.getPricingStats('Toyota', 'Sienna', null, null)

      expect(stats.count).toBe(3)
      expect(stats.p50).toBe(20_000_00)
    })

    it('excludes years outside the +/-2 window and respects conversionType', async () => {
      const source = await createSource(db)
      await createListing(db, source.id, { make: 'Ford', model: 'Transit', year: 2020, priceCents: 5_000_00, conversionType: 'rear_entry' })
      await createListing(db, source.id, { make: 'Ford', model: 'Transit', year: 2024, priceCents: 9_000_00, conversionType: 'rear_entry' })
      // Outside window.
      await createListing(db, source.id, { make: 'Ford', model: 'Transit', year: 2010, priceCents: 1_00, conversionType: 'rear_entry' })
      // Wrong conversion type.
      await createListing(db, source.id, { make: 'Ford', model: 'Transit', year: 2021, priceCents: 7_000_00, conversionType: 'side_entry' })

      const stats = await repo.getPricingStats('Ford', 'Transit', 2022, 'rear_entry')

      expect(stats.count).toBe(2)
    })

    it('computes dropTotal/dropCount from real listing_price_history rows', async () => {
      const source = await createSource(db)
      const dropped = await createListing(db, source.id, { make: 'Ram', model: 'ProMaster', year: 2020 })
      const steady = await createListing(db, source.id, { make: 'Ram', model: 'ProMaster', year: 2020 })

      // Price dropped over time: first observation higher than latest.
      await db.listingPriceHistory.create({
        data: { listingId: dropped.id, priceCents: 30_000_00, recordedAt: new Date('2026-01-01T00:00:00Z') },
      })
      await db.listingPriceHistory.create({
        data: { listingId: dropped.id, priceCents: 25_000_00, recordedAt: new Date('2026-02-01T00:00:00Z') },
      })
      // Price unchanged over time — must not count as a drop.
      await db.listingPriceHistory.create({
        data: { listingId: steady.id, priceCents: 20_000_00, recordedAt: new Date('2026-01-01T00:00:00Z') },
      })
      await db.listingPriceHistory.create({
        data: { listingId: steady.id, priceCents: 20_000_00, recordedAt: new Date('2026-02-01T00:00:00Z') },
      })

      const stats = await repo.getPricingStats('Ram', 'ProMaster', null, null)

      expect(stats.dropTotal).toBe(2)
      expect(stats.dropCount).toBe(1)
    })

    it('computes median source listing age and excludes listings without a source date', async () => {
      const source = await createSource(db)
      const now = Date.now()
      const day = 24 * 60 * 60 * 1000
      const internalListedAt = new Date(now - 120 * day)
      await createListing(db, source.id, {
        make: 'Toyota',
        model: 'Sienna',
        priceCents: 10_000_00,
        listedAt: internalListedAt,
        sourceListedAt: new Date(now - 10 * day),
      })
      await createListing(db, source.id, {
        make: 'Toyota',
        model: 'Sienna',
        priceCents: 20_000_00,
        listedAt: internalListedAt,
        sourceListedAt: new Date(now - 30 * day),
      })
      await createListing(db, source.id, {
        make: 'Toyota',
        model: 'Sienna',
        priceCents: 30_000_00,
        listedAt: internalListedAt,
        sourceListedAt: null,
      })

      const stats = await repo.getPricingStats('Toyota', 'Sienna', null, null)

      expect(stats.count).toBe(3)
      expect(stats.medianDaysListed).toBeCloseTo(20, 2)
    })
  })

  describe('getPopular', () => {
    it('ranks makes, models, and conversion brands by eligible listing count', async () => {
      const source = await createSource(db)
      await createListing(db, source.id, { make: 'Toyota', model: 'Sienna', conversionManufacturer: 'BraunAbility' })
      await createListing(db, source.id, { make: 'Toyota', model: 'Sienna', conversionManufacturer: 'BraunAbility' })
      await createListing(db, source.id, { make: 'Honda', model: 'Odyssey', conversionManufacturer: null })

      const popular = await repo.getPopular()

      expect(popular.makes[0]).toEqual({ make: 'Toyota', count: 2 })
      expect(popular.models[0]).toEqual({ make: 'Toyota', model: 'Sienna', count: 2 })
      expect(popular.conversionBrands[0]).toEqual({ conversionManufacturer: 'BraunAbility', count: 2 })
    })
  })

  describe('getTrends', () => {
    it('averages source-listed-to-gone durations and excludes missing source dates', async () => {
      const source = await createSource(db)
      const goneAt = new Date('2026-05-11T00:00:00Z')
      const internalListedAt = new Date('2026-01-01T00:00:00Z')
      await createListing(db, source.id, {
        make: 'Honda',
        model: 'Odyssey',
        status: 'gone',
        listedAt: internalListedAt,
        sourceListedAt: new Date('2026-05-01T00:00:00Z'),
        goneAt,
      })
      await createListing(db, source.id, {
        make: 'Honda',
        model: 'Odyssey',
        status: 'gone',
        listedAt: internalListedAt,
        sourceListedAt: new Date('2026-04-11T00:00:00Z'),
        goneAt,
      })
      await createListing(db, source.id, {
        make: 'Honda',
        model: 'Odyssey',
        status: 'gone',
        listedAt: internalListedAt,
        sourceListedAt: null,
        goneAt,
      })

      const trends = await repo.getTrends(
        'Honda',
        'Odyssey',
        'month',
        new Date('2026-05-01T00:00:00Z'),
        new Date('2026-05-31T23:59:59Z'),
      )

      expect(trends).toHaveLength(1)
      expect(trends[0]?.avgDaysToGone).toBeCloseTo(20, 6)
    })
  })
})
