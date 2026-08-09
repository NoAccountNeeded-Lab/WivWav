import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { ZodError } from 'zod'
import { MockQueueFactory } from '@wivwav/queue'
import { describe, expect, it } from 'vitest'
import { internalScraperRoutes } from './internal-scraper.js'

/**
 * Minimal in-memory fake of the Prisma tables these routes touch. Not a
 * general-purpose Prisma mock — just enough CRUD semantics to exercise the
 * routes' own idempotency logic (the underlying ported functions —
 * ingestListing, markGoneListings, the detail-extract diff — are already
 * exhaustively unit-tested against their real behavior in packages/db).
 * `$transaction` runs the callback against this same fake, since the tests
 * here don't depend on transaction isolation.
 */
function createFakeDb() {
  const listings: Record<string, unknown>[] = []
  const rawPages: Record<string, unknown>[] = []
  const listingObservations: Record<string, unknown>[] = []
  const scraperRuns: Record<string, unknown>[] = []
  let idCounter = 0
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`

  const db = {
    listing: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['id']) return listings.find((l) => l['id'] === where['id']) ?? null
        const compound = where['sourceId_sourceRecordKey'] as
          { sourceId: string; sourceRecordKey: string } | undefined
        if (compound) {
          return (
            listings.find(
              (l) =>
                l['sourceId'] === compound.sourceId &&
                l['sourceRecordKey'] === compound.sourceRecordKey,
            ) ?? null
          )
        }
        return null
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['sourceUrl'])
          return listings.find((l) => l['sourceUrl'] === where['sourceUrl']) ?? null
        return null
      },
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        // Mirrors Prisma schema defaults (schema.prisma's Listing.status
        // @default(active)) that a real create() applies but this fake's
        // literal `data` spread would otherwise omit.
        const row = { id: nextId('listing'), updatedAt: new Date(), status: 'active', ...data }
        listings.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = listings.find((l) => l['id'] === where.id)
        if (!row) throw new Error('listing not found')
        Object.assign(row, data, { updatedAt: new Date() })
        return row
      },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    listingPriceHistory: { create: async () => ({}) },
    listingMileageHistory: { create: async () => ({}) },
    listingConversionHistory: { create: async () => ({}) },
    listingObservation: {
      findUnique: async ({
        where,
      }: {
        where: { stage_reference: { stage: string; reference: string } }
      }) =>
        listingObservations.find(
          (o) =>
            o['stage'] === where.stage_reference.stage &&
            o['reference'] === where.stage_reference.reference,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId('obs'), ...data }
        listingObservations.push(row)
        return row
      },
      upsert: async ({
        where,
      }: {
        where: { stage_reference: { stage: string; reference: string } }
      }) => {
        const existing = listingObservations.find(
          (o) =>
            o['stage'] === where.stage_reference.stage &&
            o['reference'] === where.stage_reference.reference,
        )
        if (existing) return existing
        const row = {
          id: nextId('obs'),
          stage: where.stage_reference.stage,
          reference: where.stage_reference.reference,
        }
        listingObservations.push(row)
        return row
      },
    },
    rawPage: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        if (where['id']) return rawPages.find((p) => p['id'] === where['id']) ?? null
        if (where['url']) return rawPages.find((p) => p['url'] === where['url']) ?? null
        return null
      },
      findMany: async () => [],
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { url: string }
        create: Record<string, unknown>
        update: Record<string, unknown>
      }) => {
        const existing = rawPages.find((p) => p['url'] === where.url)
        if (existing) {
          Object.assign(existing, update)
          return existing
        }
        const row = { id: nextId('raw'), scrapedAt: new Date(), processedAt: null, ...create }
        rawPages.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rawPages.find((p) => p['id'] === where.id)
        if (!row) throw new Error('raw page not found')
        Object.assign(row, data)
        return row
      },
    },
    scraperRun: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        scraperRuns.find((r) => r['id'] === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId('run'), ...data }
        scraperRuns.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = scraperRuns.find((r) => r['id'] === where.id)
        if (!row) throw new Error('scraper run not found')
        Object.assign(row, data)
        return row
      },
    },
    source: {
      findUnique: async () => null,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    $executeRaw: async () => 0,
    $transaction: async (fnOrArray: unknown) => {
      if (typeof fnOrArray === 'function') return fnOrArray(db)
      return Promise.all(fnOrArray as Promise<unknown>[])
    },
  }

  return { db, listings, rawPages, listingObservations, scraperRuns }
}

function buildTestApp() {
  const fake = createFakeDb()
  const queueFactory = new MockQueueFactory()
  const app = Fastify()
  // Mirrors app.ts's global ZodError -> 400 translation (see its
  // setErrorHandler docstring): schema.parse() throws a raw ZodError, which
  // must not surface as an unhandled 500.
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: error.message } })
    }
    return reply.send(error)
  })
  const ready = app
    .register(sensible)
    .register(internalScraperRoutes, { db: fake.db as never, queueFactory })
  return { app, ready, ...fake }
}

const validListingPayload = {
  sourceId: 'src-1',
  sourceUrl: 'https://dealer.example/listing/1',
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
  priceCents: 4599900,
  mileage: 32000,
  color: 'Silver',
  fuelType: null,
  transmission: null,
  wav: {
    conversionType: 'unknown',
    conversionManufacturer: null,
    floorLoweringInches: null,
    rampType: 'unknown',
    conversionStatus: 'unknown',
    wavFeatures: [],
    wheelchairCapacity: null,
  },
  location: { zip: '30301', city: 'Atlanta', state: 'GA', lat: null, lng: null },
  dealer: { name: 'Example Mobility', phone: null, website: null },
  images: ['https://dealer.example/img/1.jpg'],
  description: 'Clean one-owner WAV.',
  saleStatus: 'active',
  soldAt: null,
  listedAt: '2026-08-01T00:00:00.000Z',
}

describe('POST /listings/upsert', () => {
  it('creates a new listing on first submission', async () => {
    const { app, ready } = buildTestApp()
    await ready
    const response = await app.inject({
      method: 'POST',
      url: '/listings/upsert',
      payload: validListingPayload,
    })
    expect(response.json().data.outcome).toBe('created')
    await app.close()
  })

  it('is idempotent: an identical second submission reports unchanged and writes no new observation', async () => {
    const { app, ready, listingObservations } = buildTestApp()
    await ready
    await app.inject({ method: 'POST', url: '/listings/upsert', payload: validListingPayload })
    const observationCountAfterFirst = listingObservations.length

    const second = await app.inject({
      method: 'POST',
      url: '/listings/upsert',
      payload: validListingPayload,
    })
    expect(second.json().data.outcome).toBe('unchanged')
    expect(listingObservations.length).toBe(observationCountAfterFirst)
    await app.close()
  })

  it('rejects a payload missing a required field', async () => {
    const { app, ready } = buildTestApp()
    await ready
    const invalid: Record<string, unknown> = { ...validListingPayload }
    delete invalid['sourceRecordKey']
    const response = await app.inject({ method: 'POST', url: '/listings/upsert', payload: invalid })
    expect(response.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /sources/:sourceId/listings/mark-gone', () => {
  it('applies markGone and records the run marker on first call', async () => {
    const { app, ready, scraperRuns } = buildTestApp()
    await ready
    const runId = 'run-1'
    scraperRuns.push({ id: runId })

    const response = await app.inject({
      method: 'POST',
      url: '/sources/src-1/listings/mark-gone',
      payload: {
        sourceId: 'src-1',
        scraperRunId: runId,
        activeSourceRecordKeys: ['a'],
        isCompleteCrawl: false,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(scraperRuns[0]?.['markGoneAppliedAt']).toBeInstanceOf(Date)
  })

  it('replays the stored count on a retried call for the same scraperRunId, without recomputing', async () => {
    const { app, ready, scraperRuns } = buildTestApp()
    await ready
    const runId = 'run-1'
    scraperRuns.push({ id: runId, markGoneAppliedAt: new Date(), markGoneNewlyMissingCount: 7 })

    const response = await app.inject({
      method: 'POST',
      url: '/sources/src-1/listings/mark-gone',
      payload: {
        sourceId: 'src-1',
        scraperRunId: runId,
        activeSourceRecordKeys: ['a'],
        isCompleteCrawl: true,
      },
    })

    expect(response.json().data.goneCount).toBe(7)
  })

  it('rejects a mismatched sourceId between the URL and body', async () => {
    const { app, ready } = buildTestApp()
    await ready
    const response = await app.inject({
      method: 'POST',
      url: '/sources/src-1/listings/mark-gone',
      payload: {
        sourceId: 'src-2',
        scraperRunId: 'run-1',
        activeSourceRecordKeys: [],
        isCompleteCrawl: false,
      },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('POST /detail-extract/submit', () => {
  it('reports listing_not_found and marks the raw page processed when listingId is null', async () => {
    const { app, ready, rawPages } = buildTestApp()
    await ready
    rawPages.push({
      id: 'raw-1',
      url: 'https://dealer.example/1',
      scrapedAt: new Date('2026-08-01T00:00:00.000Z'),
      processedAt: null,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/detail-extract/submit',
      payload: {
        sourceId: 'src-1',
        rawPageId: 'raw-1',
        listingId: null,
        detail: minimalDetail(),
        enrichment: { dealerWebsite: null, directVehicleUrl: null },
      },
    })

    expect(response.json().data.outcome).toBe('listing_not_found')
    expect(rawPages[0]?.['processedAt']).toBeInstanceOf(Date)
  })

  it('returns 404 for an unknown rawPageId', async () => {
    const { app, ready } = buildTestApp()
    await ready
    const response = await app.inject({
      method: 'POST',
      url: '/detail-extract/submit',
      payload: {
        sourceId: 'src-1',
        rawPageId: 'unknown',
        listingId: null,
        detail: minimalDetail(),
        enrichment: { dealerWebsite: null, directVehicleUrl: null },
      },
    })
    expect(response.statusCode).toBe(404)
  })

  it('is idempotent: a repeated submission for an already-recorded observation reports already_applied', async () => {
    const { app, ready, rawPages, listings, listingObservations } = buildTestApp()
    await ready
    const scrapedAt = new Date('2026-08-01T00:00:00.000Z')
    rawPages.push({ id: 'raw-1', url: 'https://dealer.example/1', scrapedAt, processedAt: null })
    listings.push({
      id: 'listing-1',
      status: 'active',
      soldAt: null,
      missingFromCompleteCount: 0,
      updatedAt: new Date(),
    })
    listingObservations.push({
      stage: 'detail',
      reference: `raw-1:${scrapedAt.toISOString()}`,
      changedFields: ['color'],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/detail-extract/submit',
      payload: {
        sourceId: 'src-1',
        rawPageId: 'raw-1',
        listingId: 'listing-1',
        detail: minimalDetail(),
        enrichment: { dealerWebsite: null, directVehicleUrl: null },
      },
    })

    expect(response.json().data).toEqual({ outcome: 'already_applied', changedFields: ['color'] })
  })
})

function minimalDetail() {
  return {
    color: null,
    fuelType: null,
    engine: null,
    transmission: null,
    rampType: 'unknown',
    conversionType: 'unknown',
    wavFeatures: [],
    floorLoweringInches: null,
    wheelchairCapacity: null,
    description: null,
    images: [],
    zip: null,
    dealerPhone: null,
    saleStatus: 'active',
    sourceListedAt: null,
    sourceUpdatedAt: null,
    evidence: {
      color: 'missing',
      fuelType: 'missing',
      engine: 'missing',
      transmission: 'missing',
      description: 'missing',
      images: 'missing',
      accessibilityClaims: 'missing',
    },
  }
}
