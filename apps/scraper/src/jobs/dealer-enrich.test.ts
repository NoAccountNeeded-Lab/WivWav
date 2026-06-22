import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))

import { getDb } from '@wivwav/db'
import { runDealerEnrichJob } from './dealer-enrich.js'

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listing: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    dealerProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'dp-1' }),
    },
    dealerReview: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function mockPlacesApi(placeId: string | null, details: Record<string, unknown> | null) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes('findplacefromtext')) {
      if (!placeId) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ZERO_RESULTS', candidates: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'OK', candidates: [{ place_id: placeId }] }),
      })
    }
    if ((url as string).includes('place/details')) {
      if (!details) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'NOT_FOUND' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'OK', result: details }),
      })
    }
    return Promise.resolve({ ok: false })
  })
}

describe('runDealerEnrichJob', () => {
  let db: ReturnType<typeof makeDb>
  const originalEnv = process.env['GOOGLE_PLACES_API_KEY']

  beforeEach(() => {
    db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['GOOGLE_PLACES_API_KEY']
    } else {
      process.env['GOOGLE_PLACES_API_KEY'] = originalEnv
    }
  })

  it('exits early and logs a warning when GOOGLE_PLACES_API_KEY is not set', async () => {
    delete process.env['GOOGLE_PLACES_API_KEY']

    await runDealerEnrichJob()

    expect(db.listing.findMany).not.toHaveBeenCalled()
    expect(db.$disconnect).not.toHaveBeenCalled()
  })

  it('does nothing when no listings with dealerName+zip exist', async () => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
    db.listing.findMany.mockResolvedValue([])

    await runDealerEnrichJob()

    expect(db.dealerProfile.upsert).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('skips dealers that already have a fresh profile', async () => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
    db.listing.findMany.mockResolvedValue([
      { dealerName: 'ABC Mobility', zip: '30301' },
    ])
    // Already enriched recently
    db.dealerProfile.findUnique.mockResolvedValue({
      id: 'dp-existing',
      enrichedAt: new Date(),
    })

    await runDealerEnrichJob()

    // No Places API calls should have been made
    expect(db.dealerProfile.upsert).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('enriches a dealer when no profile exists', async () => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
    db.listing.findMany.mockResolvedValue([
      { dealerName: 'ABC Mobility', zip: '30301' },
    ])
    db.dealerProfile.findUnique.mockResolvedValue(null)
    mockPlacesApi('ChIJplace123', {
      rating: 4.5,
      user_ratings_total: 120,
      reviews: [
        {
          author_name: 'Alice',
          rating: 5,
          text: 'Great service!',
          time: 1700000000,
        },
        {
          author_name: 'Bob',
          rating: 4,
          text: 'Very helpful.',
          time: 1699000000,
        },
      ],
      opening_hours: { weekday_text: ['Monday: 9 AM – 5 PM'] },
    })

    await runDealerEnrichJob()

    expect(db.dealerProfile.upsert).toHaveBeenCalledOnce()
    const upsertCall = db.dealerProfile.upsert.mock.calls[0]![0]
    expect(upsertCall.where).toEqual({ name_zip: { name: 'ABC Mobility', zip: '30301' } })
    expect(upsertCall.create.googlePlaceId).toBe('ChIJplace123')
    expect(upsertCall.create.rating).toBe(4.5)
    expect(upsertCall.create.reviewCount).toBe(120)

    expect(db.dealerReview.upsert).toHaveBeenCalledTimes(2)

    expect(db.listing.updateMany).toHaveBeenCalledWith({
      where: { dealerName: 'ABC Mobility', zip: '30301' },
      data: { dealerProfileId: 'dp-1' },
    })

    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('handles places text search returning no results gracefully', async () => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
    db.listing.findMany.mockResolvedValue([
      { dealerName: 'Unknown Dealer', zip: '99999' },
    ])
    db.dealerProfile.findUnique.mockResolvedValue(null)
    mockPlacesApi(null, null)

    await runDealerEnrichJob()

    expect(db.dealerProfile.upsert).not.toHaveBeenCalled()
    expect(db.$disconnect).toHaveBeenCalled()
  })

  it('deduplicates reviews on re-enrichment via upsert key', async () => {
    process.env['GOOGLE_PLACES_API_KEY'] = 'test-key'
    db.listing.findMany.mockResolvedValue([
      { dealerName: 'Repeat Dealer', zip: '10001' },
    ])
    // Profile exists but is stale
    db.dealerProfile.findUnique.mockResolvedValue({
      id: 'dp-stale',
      enrichedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })
    mockPlacesApi('ChIJstale', {
      rating: 4.0,
      user_ratings_total: 50,
      reviews: [
        {
          author_name: 'Carol',
          rating: 4,
          text: 'Good experience.',
          time: 1695000000,
        },
      ],
    })

    await runDealerEnrichJob()

    // Review upsert uses the dedup key — same call pattern whether new or existing
    expect(db.dealerReview.upsert).toHaveBeenCalledOnce()
    const reviewCall = db.dealerReview.upsert.mock.calls[0]![0]
    expect(reviewCall.where.dealerId_source_publishedAt_authorName.authorName).toBe('Carol')
    expect(reviewCall.where.dealerId_source_publishedAt_authorName.source).toBe('google')
  })
})
