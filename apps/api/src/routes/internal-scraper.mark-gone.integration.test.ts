import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { MockQueueFactory } from '@wivwav/queue'
import { GONE_AFTER_CONSECUTIVE_MISSING } from '@wivwav/db'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { internalScraperRoutes } from './internal-scraper.js'
import {
  closeIntegrationDb,
  createListing,
  createSource,
  integrationDb,
  resetIntegrationDb,
} from '../test-support/integration-db.js'

/**
 * Exercises the mark-gone route's ScraperRun persistence against a real,
 * migrated Postgres (#986) — internal-scraper.test.ts's fake db always
 * returns updateMany/count as 0, so it can't verify isCompleteCrawl or
 * markGoneNewlyGoneCount are actually derived from real listing rows. This
 * builds the per-source crawl-completeness and gone-promotion history that
 * #676 needs before GONE_AFTER_CONSECUTIVE_MISSING can be re-tuned.
 */
describe('POST /sources/:sourceId/listings/mark-gone — ScraperRun persistence (integration)', () => {
  const db = integrationDb()

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  function buildApp() {
    const queueFactory = new MockQueueFactory()
    const app = Fastify()
    const ready = app
      .register(sensible)
      .register(internalScraperRoutes, { db, queueFactory })
    return { app, ready }
  }

  it('persists isCompleteCrawl=true and the gone-promotion count for a complete crawl', async () => {
    const source = await createSource(db)
    const run = await db.scraperRun.create({ data: { sourceId: source.id } })

    // Stays active — present in the crawled set.
    await createListing(db, source.id, { sourceRecordKey: 'seen-1', status: 'active' })
    // Newly absent this run — was active, not in the crawled set.
    await createListing(db, source.id, { sourceRecordKey: 'missing-1', status: 'active' })
    // One crawl away from the gone threshold — promotes to gone this run.
    await createListing(db, source.id, {
      sourceRecordKey: 'missing-2',
      status: 'possibly_gone',
      missingFromCompleteCount: GONE_AFTER_CONSECUTIVE_MISSING - 1,
    })

    const { app, ready } = buildApp()
    await ready
    const response = await app.inject({
      method: 'POST',
      url: `/sources/${source.id}/listings/mark-gone`,
      payload: {
        sourceId: source.id,
        scraperRunId: run.id,
        activeSourceRecordKeys: ['seen-1'],
        isCompleteCrawl: true,
      },
    })
    await app.close()

    expect(response.statusCode).toBe(200)
    expect(response.json().data.goneCount).toBe(1)

    const updatedRun = await db.scraperRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updatedRun.isCompleteCrawl).toBe(true)
    expect(updatedRun.markGoneNewlyMissingCount).toBe(1)
    expect(updatedRun.markGoneNewlyGoneCount).toBe(1)

    const promoted = await db.listing.findFirstOrThrow({ where: { sourceRecordKey: 'missing-2' } })
    expect(promoted.status).toBe('gone')
  })

  it('persists isCompleteCrawl=false and a zero gone-promotion count for a partial crawl', async () => {
    const source = await createSource(db)
    const run = await db.scraperRun.create({ data: { sourceId: source.id } })

    await createListing(db, source.id, { sourceRecordKey: 'seen-1', status: 'active' })
    await createListing(db, source.id, { sourceRecordKey: 'missing-1', status: 'active' })
    // Even one crawl away from the threshold, a partial crawl never promotes.
    await createListing(db, source.id, {
      sourceRecordKey: 'missing-2',
      status: 'possibly_gone',
      missingFromCompleteCount: GONE_AFTER_CONSECUTIVE_MISSING - 1,
    })

    const { app, ready } = buildApp()
    await ready
    const response = await app.inject({
      method: 'POST',
      url: `/sources/${source.id}/listings/mark-gone`,
      payload: {
        sourceId: source.id,
        scraperRunId: run.id,
        activeSourceRecordKeys: ['seen-1'],
        isCompleteCrawl: false,
      },
    })
    await app.close()

    expect(response.statusCode).toBe(200)

    const updatedRun = await db.scraperRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updatedRun.isCompleteCrawl).toBe(false)
    expect(updatedRun.markGoneNewlyGoneCount).toBe(0)

    const unpromoted = await db.listing.findFirstOrThrow({ where: { sourceRecordKey: 'missing-2' } })
    expect(unpromoted.status).toBe('possibly_gone')
  })
})
