import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { MockQueueFactory } from '@wivwav/queue'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { internalScraperRoutes } from '../routes/internal-scraper.js'
import { internalOpsDealerSiteCandidatesRoutes } from '../routes/internal-ops-dealer-site-candidates.js'
import { HttpEnrichGatewayRepository } from '../repositories/scraper-gateway/http-enrich-gateway-repository.js'
import { backfillDealerSiteCandidates } from './dealer-site-candidate-backfill.js'
import {
  closeIntegrationDb,
  createListing,
  createSource,
  integrationDb,
  resetIntegrationDb,
} from '../test-support/integration-db.js'

/**
 * #1178 against a real, migrated Postgres: the detail-extract and
 * dealer-enrich capture paths, backfill idempotency, and the read route.
 */
describe('dealer site candidates (integration)', () => {
  const db = integrationDb()

  beforeEach(async () => {
    await resetIntegrationDb(db)
  })

  afterAll(async () => {
    await resetIntegrationDb(db)
    await closeIntegrationDb()
  })

  const detail = {
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

  let rawPageSeq = 0
  async function submitDetail(sourceId: string, listingId: string, dealerWebsite: string | null) {
    const app = Fastify()
    const cache = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) }
    await app
      .register(sensible)
      .register(internalScraperRoutes, {
        db,
        queueFactory: new MockQueueFactory(),
        cache: cache as never,
        configEncryptionSecret: 'a'.repeat(64),
      })
      .ready()
    const rawPage = await db.rawPage.create({
      data: { url: `https://raw.example/${listingId}`, sourceId, html: '<html></html>' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/detail-extract/submit',
      payload: {
        sourceId,
        rawPageId: rawPage.id,
        listingId,
        detail,
        enrichment: { dealerWebsite, directVehicleUrl: null },
      },
    })
    await app.close()
    return res
  }

  it('detail-extract creates one candidate per normalized origin and skips denylisted or malformed sites', async () => {
    const source = await createSource(db)
    const [a, b, c, d] = await Promise.all([
      createListing(db, source.id),
      createListing(db, source.id),
      createListing(db, source.id),
      createListing(db, source.id),
    ])
    expect((await submitDetail(source.id, a.id, 'https://www.Dealer.com/inventory?x=1')).statusCode).toBe(200)
    expect((await submitDetail(source.id, b.id, 'http://dealer.com/')).statusCode).toBe(200)
    expect((await submitDetail(source.id, c.id, 'https://www.facebook.com/dealer')).statusCode).toBe(200)
    expect((await submitDetail(source.id, d.id, 'http://')).statusCode).toBe(200)

    const rows = await db.dealerSiteCandidate.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      origin: 'https://dealer.com',
      discoveredVia: 'listing_dealer_website',
      status: 'pending_review',
    })
    const members = await db.listing.findMany({ where: { dealerSiteCandidateId: rows[0]!.id }, select: { id: true } })
    expect(members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort())
    for (const id of [c.id, d.id]) {
      expect((await db.listing.findUniqueOrThrow({ where: { id } })).dealerSiteCandidateId).toBeNull()
    }
    expect(await db.source.count()).toBe(1)
  })

  it('detail-extract membership moves A -> B -> A: counts once for A, zero for B', async () => {
    const source = await createSource(db)
    const listing = await createListing(db, source.id)
    const counts = async () =>
      Object.fromEntries(
        (await db.dealerSiteCandidate.findMany({ include: { _count: { select: { listings: true } } } })).map((c) => [
          c.origin,
          c._count.listings,
        ]),
      )
    await submitDetail(source.id, listing.id, 'https://a.com')
    expect(await counts()).toEqual({ 'https://a.com': 1 })
    await submitDetail(source.id, listing.id, 'https://b.com')
    expect(await counts()).toEqual({ 'https://a.com': 0, 'https://b.com': 1 })
    await submitDetail(source.id, listing.id, 'https://a.com/again')
    expect(await counts()).toEqual({ 'https://a.com': 1, 'https://b.com': 0 })
    // Resubmitting the same origin never double-counts.
    await submitDetail(source.id, listing.id, 'https://www.a.com/x')
    expect(await counts()).toEqual({ 'https://a.com': 1, 'https://b.com': 0 })
  })

  it('dealer-enrich stores the Places website and links the candidate to the profile', async () => {
    const repo = new HttpEnrichGatewayRepository(db)
    const { dealerId } = await repo.submitDealerEnrich({
      dealerName: 'ACME Mobility',
      zip: '90210',
      googlePlaceId: 'place-1',
      rating: 4.5,
      reviewCount: 10,
      hours: null,
      website: 'https://www.acme-mobility.com/vans',
      reviews: [],
    })
    const profile = await db.dealerProfile.findUniqueOrThrow({ where: { id: dealerId } })
    expect(profile.website).toBe('https://www.acme-mobility.com/vans')
    const rows = await db.dealerSiteCandidate.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      origin: 'https://acme-mobility.com',
      discoveredVia: 'google_places',
      dealerProfileId: dealerId,
      dealerName: 'ACME Mobility',
    })

    // A later enrich without a website keeps the stored one.
    await repo.submitDealerEnrich({
      dealerName: 'ACME Mobility',
      zip: '90210',
      googlePlaceId: 'place-1',
      rating: 4.6,
      reviewCount: 11,
      hours: null,
      website: null,
      reviews: [],
    })
    expect((await db.dealerProfile.findUniqueOrThrow({ where: { id: dealerId } })).website).toBe(
      'https://www.acme-mobility.com/vans',
    )
  })

  it('backfill is idempotent and links listings to candidates', async () => {
    const source = await createSource(db)
    await createListing(db, source.id, { dealerWebsite: 'https://www.dealer.com/a' })
    await createListing(db, source.id, { dealerWebsite: 'http://dealer.com/' })
    await createListing(db, source.id, { dealerWebsite: 'https://other.com' })
    await createListing(db, source.id, { dealerWebsite: 'https://facebook.com/x' })
    await createListing(db, source.id, { dealerWebsite: 'not a url' })
    const stale = await db.dealerSiteCandidate.create({
      data: { origin: 'https://old.com', sampleUrl: 'https://old.com', discoveredVia: 'listing_dealer_website' },
    })
    await createListing(db, source.id, { dealerWebsite: 'https://facebook.com/y', dealerSiteCandidateId: stale.id })
    await db.dealerProfile.create({
      data: { name: 'Profile Dealer', zip: '90210', website: 'https://profile-dealer.com' },
    })

    const snapshot = async () =>
      (await db.dealerSiteCandidate.findMany({ orderBy: { origin: 'asc' } })).map((r) => ({
        ...r,
        id: undefined,
      }))

    await backfillDealerSiteCandidates(db)
    const first = await snapshot()
    await backfillDealerSiteCandidates(db)
    const second = await snapshot()

    expect(second).toEqual(first)
    const counts = await db.dealerSiteCandidate.findMany({
      orderBy: { origin: 'asc' },
      include: { _count: { select: { listings: true } } },
    })
    expect(counts.map((r) => [r.origin, r._count.listings])).toEqual([
      ['https://dealer.com', 2],
      ['https://old.com', 0],
      ['https://other.com', 1],
      ['https://profile-dealer.com', 0],
    ])
    expect(await db.listing.count({ where: { dealerSiteCandidateId: { not: null } } })).toBe(3)
    expect(await db.source.count()).toBe(1)
  })

  it('read route filters by status and orders by derived listingCount desc', async () => {
    const source = await createSource(db)
    const base = { sampleUrl: 'https://x', discoveredVia: 'listing_dealer_website' as const }
    const make = async (origin: string, n: number, status?: 'approved') => {
      const c = await db.dealerSiteCandidate.create({ data: { origin, ...(status && { status }), ...base } })
      for (let i = 0; i < n; i++) await createListing(db, source.id, { dealerSiteCandidateId: c.id })
    }
    await make('https://low.com', 1)
    await make('https://high.com', 7)
    await make('https://done.com', 9, 'approved')
    const app = Fastify()
    await app.register(sensible).register(internalOpsDealerSiteCandidatesRoutes, { db }).ready()
    const all = await app.inject({ method: 'GET', url: '/' })
    expect(all.json().data.map((r: { origin: string }) => r.origin)).toEqual([
      'https://done.com',
      'https://high.com',
      'https://low.com',
    ])
    expect(all.json().data.map((r: { listingCount: number }) => r.listingCount)).toEqual([9, 7, 1])
    const pending = await app.inject({ method: 'GET', url: '/?status=pending_review' })
    expect(pending.json().data.map((r: { origin: string }) => r.origin)).toEqual([
      'https://high.com',
      'https://low.com',
    ])
    await app.close()
  })
})
