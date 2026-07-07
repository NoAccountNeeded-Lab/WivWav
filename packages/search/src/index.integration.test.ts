import { Meilisearch } from 'meilisearch'
import { getDb, disconnectDb } from '@wivwav/db'
import type { PrismaClient } from '@wivwav/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { INDEX_NAME, syncListings } from './index.js'

// Exercises syncListings end to end against a real, migrated Postgres and a
// real Meilisearch instance — the mocked unit tests for search-adjacent code
// never verify that a listing actually lands in (or is removed from) a real
// index (#599, refs #265).
describe('syncListings (integration)', () => {
  const db: PrismaClient = getDb()
  const meili = new Meilisearch({
    host: process.env['MEILISEARCH_HOST'] ?? 'http://localhost:7700',
    apiKey: process.env['MEILISEARCH_API_KEY'] ?? 'wav_master_key',
  })

  async function resetDb(): Promise<void> {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "listings", "sources", "vehicle" RESTART IDENTITY CASCADE`)
  }

  async function clearIndex(): Promise<void> {
    const task = await meili.index(INDEX_NAME).deleteAllDocuments()
    await meili.tasks.waitForTask(task.taskUid, { timeout: 15_000 })
  }

  let sourceId: string

  beforeEach(async () => {
    await resetDb()
    await clearIndex()
    const source = await db.source.create({
      data: { name: `Search Integration Source ${Date.now()}`, baseUrl: 'https://example.com' },
    })
    sourceId = source.id
  })

  afterAll(async () => {
    await resetDb()
    await clearIndex()
    await disconnectDb()
  })

  it('upserts an eligible ungrouped listing into the index', async () => {
    const listing = await db.listing.create({
      data: {
        sourceId,
        sourceUrl: 'https://example.com/1',
        sourceRecordKey: 'sync-1',
        make: 'Toyota',
        model: 'Sienna',
        year: 2020,
        condition: 'used',
        sellerType: 'dealer',
        status: 'active',
        publicationStatus: 'eligible',
        listedAt: new Date(),
        images: [],
      },
    })

    await syncListings([listing.id], db, meili)
    // addDocuments enqueues an async Meilisearch indexing task; poll until it lands.
    await waitForIndexed(meili, listing.id)

    const doc = await meili.index(INDEX_NAME).getDocument(listing.id)
    expect(doc['make']).toBe('Toyota')
    expect(doc['model']).toBe('Sienna')
  })

  it('deletes an ineligible listing from the index', async () => {
    const listing = await db.listing.create({
      data: {
        sourceId,
        sourceUrl: 'https://example.com/2',
        sourceRecordKey: 'sync-2',
        make: 'Honda',
        model: 'Odyssey',
        year: 2019,
        condition: 'used',
        sellerType: 'dealer',
        status: 'active',
        publicationStatus: 'eligible',
        listedAt: new Date(),
        images: [],
      },
    })

    await syncListings([listing.id], db, meili)
    await waitForIndexed(meili, listing.id)

    await db.listing.update({ where: { id: listing.id }, data: { publicationStatus: 'quarantined' } })
    await syncListings([listing.id], db, meili)
    await waitForDeleted(meili, listing.id)

    await expect(meili.index(INDEX_NAME).getDocument(listing.id)).rejects.toThrow()
  })

  it('indexes only the deterministic representative of a verified vehicle group', async () => {
    const vehicle = await db.vehicle.create({
      data: { make: 'Ford', model: 'Transit', year: 2021 },
    })

    const stale = await db.listing.create({
      data: {
        sourceId,
        vehicleId: vehicle.id,
        sourceUrl: 'https://example.com/3',
        sourceRecordKey: 'sync-3',
        make: 'Ford',
        model: 'Transit',
        year: 2021,
        condition: 'used',
        sellerType: 'dealer',
        status: 'active',
        publicationStatus: 'eligible',
        listedAt: new Date(),
        images: [],
        scrapedAt: new Date('2025-01-01T00:00:00Z'),
      },
    })
    const fresh = await db.listing.create({
      data: {
        sourceId,
        vehicleId: vehicle.id,
        sourceUrl: 'https://example.com/4',
        sourceRecordKey: 'sync-4',
        make: 'Ford',
        model: 'Transit',
        year: 2021,
        condition: 'used',
        sellerType: 'dealer',
        status: 'active',
        publicationStatus: 'eligible',
        listedAt: new Date(),
        images: [],
        scrapedAt: new Date('2026-01-01T00:00:00Z'),
      },
    })

    await syncListings([stale.id, fresh.id], db, meili)
    await waitForIndexed(meili, fresh.id)

    await expect(meili.index(INDEX_NAME).getDocument(fresh.id)).resolves.toBeDefined()
    await expect(meili.index(INDEX_NAME).getDocument(stale.id)).rejects.toThrow()
  })
})

async function waitForIndexed(meili: Meilisearch, id: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await meili.index(INDEX_NAME).getDocument(id)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`Timed out waiting for document ${id} to be indexed`)
}

async function waitForDeleted(meili: Meilisearch, id: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await meili.index(INDEX_NAME).getDocument(id)
      await new Promise((resolve) => setTimeout(resolve, 200))
    } catch {
      return
    }
  }
  throw new Error(`Timed out waiting for document ${id} to be deleted`)
}
