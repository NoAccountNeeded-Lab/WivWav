import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeIntegrationDb, createSource, integrationDb, resetIntegrationDb } from '../test-support/integration-db.js'

// Guards the #1113 `listings` index consolidation in both directions:
// the pg_indexes catalog must show the new composites (with their
// migration-only partial predicates) and none of the dropped indexes,
// and EXPLAIN for both hot queries must resolve to the new composites
// with no sequential scan.
describe('listings hot-query indexes (integration)', () => {
  const db = integrationDb()

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  // Rows are spread across a drain source (1/5 of rows, holding the
  // pending backlog) and a market source (4/5) with interleaved ids, so
  // the drain's sourceId equality is selective against primary-key order
  // and neither hot query can be satisfied by a pkey-order scan that
  // happens to correlate with insertion order. Each plan test seeds the
  // `pending` fraction that makes its predicate the selective one — a
  // rare backlog for the drain (production-like), a common one for the
  // market CTE so the status+publicationStatus prefix pays off at this
  // scale. The production-scale plan choice for both queries is covered
  // by the 120k-row EXPLAIN evidence recorded on the issue, not by this
  // guard.
  const FIXTURE_ROWS = 20000

  async function seedFixture(resolveSourceId: string, marketSourceId: string, pendingEvery: number): Promise<void> {
    await db.$executeRawUnsafe(`
      INSERT INTO listings (id, "sourceId", "sourceUrl", "sourceRecordKey",
        make, model, year, condition, "sellerType", status, "publicationStatus",
        "priceCents", "listedAt", "updatedAt", "scrapedAt", images)
      SELECT
        'hx-' || lpad(g::text, 7, '0'),
        CASE WHEN g % 5 = 0 THEN '${resolveSourceId}' ELSE '${marketSourceId}' END,
        'https://index-guard.example.com/listing-' || g,
        'hx-key-' || g,
        (ARRAY['Toyota', 'Honda', 'Ford', 'Ram', 'Chrysler', 'Kia'])[1 + (g % 6)],
        (ARRAY['Sienna', 'Odyssey', 'Transit', 'ProMaster', 'Pacifica', 'Carnival'])[1 + (g % 6)],
        2016 + (g % 10),
        'used'::"ListingCondition",
        'dealer'::"ListingSellerType",
        (CASE WHEN g % 25 = 0 THEN 'gone' WHEN g % 17 = 0 THEN 'possibly_gone' ELSE 'active' END)::"ListingStatus",
        (CASE WHEN g % ${pendingEvery} = 0 THEN 'pending' WHEN g % 31 = 0 THEN 'quarantined' ELSE 'eligible' END)::"ListingPublicationStatus",
        CASE WHEN g % 9 = 0 THEN NULL ELSE 500000 + (g % 500) * 1000 END,
        NOW() - ((g % 400) || ' days')::interval,
        NOW(),
        NOW(),
        '{}'
      FROM generate_series(1, ${FIXTURE_ROWS}) g
    `)
    await db.$executeRawUnsafe('ANALYZE listings')
  }

  type IndexDefRow = { indexname: string; indexdef: string }
  type ExplainRow = { 'QUERY PLAN': string }

  async function indexDefs(): Promise<Map<string, string>> {
    const rows = await db.$queryRaw<IndexDefRow[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'listings'
    `
    return new Map(rows.map((row) => [row.indexname, row.indexdef]))
  }

  describe('pg_indexes catalog', () => {
    it('has the hot-query composites and none of the dropped indexes', async () => {
      const resolveSource = await createSource(db)
      const marketSource = await createSource(db)
      await seedFixture(resolveSource.id, marketSource.id, 3)

      const defs = await indexDefs()

      expect(defs.get('listings_resolve_drain_idx')).toContain(`status <> 'gone'`)
      expect(defs.get('listings_market_status_pub_make_model_idx')).toContain(
        '(status, "publicationStatus", make, model)',
      )
      expect(defs.get('listings_vin_idx')).toContain('vin IS NOT NULL')
      expect(defs.get('listings_processingLockedAt_idx')).toContain(
        '"processingLockedAt" IS NOT NULL',
      )

      for (const dropped of [
        'listings_sourceId_idx',
        'listings_status_idx',
        'listings_status_publicationStatus_idx',
        'listings_wavFeatures_idx',
        'listings_isDuplicate_idx',
        'listings_state_idx',
        'listings_year_idx',
        'listings_priceCents_idx',
        'listings_mileage_idx',
        'listings_saleStatus_idx',
        'listings_vehicleModelId_idx',
        'listings_dealerName_zip_idx',
      ]) {
        expect(defs.has(dropped), `${dropped} should be dropped`).toBe(false)
      }
    })
  })

  describe('hot-query plans', () => {
    it('resolve drain uses listings_resolve_drain_idx with no seq scan', async () => {
      const resolveSource = await createSource(db)
      const marketSource = await createSource(db)
      await seedFixture(resolveSource.id, marketSource.id, 25)

      // Mirrors resolveSourceBacklog (apps/api/src/jobs/listing-resolve.ts):
      // sourceId + publicationStatus='pending' + status!='gone', ORDER BY id.
      const plan = await db.$queryRaw<ExplainRow[]>`
        EXPLAIN
        SELECT listings.id FROM listings
        WHERE listings."sourceId" = ${resolveSource.id}
          AND listings."publicationStatus" = 'pending'
          AND listings.status <> 'gone'
        ORDER BY listings.id ASC
        LIMIT 500
      `
      const text = plan.map((row) => row['QUERY PLAN']).join('\n')

      expect(text).toContain('listings_resolve_drain_idx')
      expect(text).not.toContain('Seq Scan')
    })

    it('market representative CTE uses listings_market_status_pub_make_model_idx with no seq scan', async () => {
      const resolveSource = await createSource(db)
      const marketSource = await createSource(db)
      await seedFixture(resolveSource.id, marketSource.id, 3)

      // Mirrors the getPricingStats representative-listings CTE
      // (apps/api/src/repositories/market-repository.ts).
      const plan = await db.$queryRaw<ExplainRow[]>`
        EXPLAIN
        WITH representative_listings AS (
          SELECT DISTINCT ON (COALESCE(listings."vehicleId", listings.id)) listings.*
          FROM listings
          INNER JOIN sources ON sources.id = listings."sourceId"
          WHERE listings.status = 'active'
            AND listings."publicationStatus" = 'eligible'
            AND sources.status != 'disabled'
            AND listings."priceCents" IS NOT NULL
            AND listings.make = 'Toyota'
            AND listings.model = 'Sienna'
          ORDER BY COALESCE(listings."vehicleId", listings.id), listings."listedAt" DESC, listings.id ASC
        )
        SELECT COUNT(*) FROM representative_listings
      `
      const text = plan.map((row) => row['QUERY PLAN']).join('\n')

      expect(text).toContain('listings_market_status_pub_make_model_idx')
      expect(text).not.toContain('Seq Scan')
    })
  })
})
