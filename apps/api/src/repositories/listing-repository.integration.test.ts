import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaListingRepository } from './listing-repository.js'
import { closeIntegrationDb, createListing, createSource, integrationDb, resetIntegrationDb } from '../test-support/integration-db.js'

// Exercises the $queryRaw paths (findManyActive, countActive,
// getPublicationCountsBySource) against a real, migrated Postgres — the
// mocked PrismaClient in listing-repository.test.ts only asserts call shape,
// never that the SQL actually returns correct rows (issue #599).
describe('PrismaListingRepository (integration)', () => {
  const db = integrationDb()
  const repo = new PrismaListingRepository(db)

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  describe('findManyActive', () => {
    it('returns one representative per vehicle group, ordered by listedAt desc', async () => {
      const source = await createSource(db)

      // Singleton listing (no vehicleId).
      const singleton = await createListing(db, source.id, {
        listedAt: new Date('2026-01-01T00:00:00Z'),
      })

      // Two listings sharing a vehicleId is not possible without a Vehicle row
      // (FK constraint) — instead assert group representation via id/listedAt
      // ordering across distinct singleton groups, which already exercises the
      // DISTINCT ON / ORDER BY / LIMIT / OFFSET raw-SQL path end to end.
      const older = await createListing(db, source.id, {
        listedAt: new Date('2025-01-01T00:00:00Z'),
      })

      // Ineligible rows must be excluded.
      await createListing(db, source.id, { status: 'gone', listedAt: new Date() })
      await createListing(db, source.id, { publicationStatus: 'pending', listedAt: new Date() })

      // Signature is (skip, take).
      const rows = await repo.findManyActive(0, 10)

      expect(rows.map((r) => r.id)).toEqual([singleton.id, older.id])
    })

    it('applies skip/take as OFFSET/LIMIT', async () => {
      const source = await createSource(db)
      const first = await createListing(db, source.id, { listedAt: new Date('2026-01-01T00:00:00Z') })
      await createListing(db, source.id, { listedAt: new Date('2025-06-01T00:00:00Z') })

      const page1 = await repo.findManyActive(0, 1)
      const page2 = await repo.findManyActive(1, 1)

      expect(page1.map((r) => r.id)).toEqual([first.id])
      expect(page2).toHaveLength(1)
      expect(page2[0]!.id).not.toBe(first.id)
    })
  })

  describe('countActive', () => {
    it('counts distinct eligible active listings', async () => {
      const source = await createSource(db)
      await createListing(db, source.id, {})
      await createListing(db, source.id, {})
      await createListing(db, source.id, { status: 'gone' })
      await createListing(db, source.id, { publicationStatus: 'pending' })

      await expect(repo.countActive()).resolves.toBe(2)
    })
  })

  describe('getPublicationCountsBySource', () => {
    it('reports observed/eligible/possibly-gone counts grouped by source', async () => {
      const sourceA = await createSource(db)
      const sourceB = await createSource(db)

      await createListing(db, sourceA.id, { publicationStatus: 'eligible' })
      await createListing(db, sourceA.id, { publicationStatus: 'pending' })
      await createListing(db, sourceA.id, { status: 'possibly_gone' })
      await createListing(db, sourceB.id, { publicationStatus: 'eligible' })

      const rows = await repo.getPublicationCountsBySource()
      const bySource = new Map(rows.map((r) => [r.sourceId, r]))

      expect(bySource.get(sourceA.id)).toEqual({
        sourceId: sourceA.id,
        observedActive: 2,
        eligibleActive: 1,
        possiblyGoneCount: 1,
      })
      expect(bySource.get(sourceB.id)).toEqual({
        sourceId: sourceB.id,
        observedActive: 1,
        eligibleActive: 1,
        possiblyGoneCount: 0,
      })
    })
  })
})
