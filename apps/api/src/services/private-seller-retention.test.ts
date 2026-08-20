import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/search', () => ({ syncListings: vi.fn().mockResolvedValue(undefined) }))

import { syncListings } from '@wivwav/search'
import {
  anonymizePrivateSellerListing,
  ListingNotFoundError,
  NotPrivateSellerError,
  retentionCutoff,
  RETENTION_DAYS,
} from './private-seller-retention.js'

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sellerType: 'private',
    sourceUrl: 'https://example.com/listing-1',
    buyerUrl: 'https://example.com/listing-1',
    retentionAppliedAt: null,
    ...overrides,
  }
}

function makeDb(listing: ReturnType<typeof makeListing> | null) {
  return {
    listing: {
      findUnique: vi.fn(async () => listing),
      update: vi.fn(async () => ({})),
    },
    // Mirrors the real Prisma client: $transaction([...]) is passed an array
    // of already-invoked (pending) promises for the non-interactive form.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    listingImageSemanticAnalysis: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    listingImage: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    rawPage: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  }
}

describe('retentionCutoff', () => {
  it('should return a date RETENTION_DAYS before now', () => {
    const now = new Date('2026-08-20T00:00:00.000Z')
    const cutoff = retentionCutoff(now)
    expect(cutoff.toISOString()).toBe(
      new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    )
  })
})

describe('anonymizePrivateSellerListing', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    vi.mocked(syncListings).mockClear()
  })

  it('should throw ListingNotFoundError when the listing does not exist', async () => {
    db = makeDb(null)

    await expect(anonymizePrivateSellerListing(db as never, {} as never, 'missing')).rejects.toThrow(
      ListingNotFoundError,
    )
  })

  it('should throw NotPrivateSellerError for a dealer listing', async () => {
    db = makeDb(makeListing({ sellerType: 'dealer' }))

    await expect(anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')).rejects.toThrow(
      NotPrivateSellerError,
    )
  })

  it('should skip a listing that already has retentionAppliedAt set', async () => {
    db = makeDb(makeListing({ retentionAppliedAt: new Date('2026-01-01') }))

    const result = await anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')

    expect(result).toEqual({
      listingId: 'listing-1',
      outcome: 'skipped-already-applied',
      fieldsCleared: [],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    })
    expect(db.listing.update).not.toHaveBeenCalled()
  })

  it('should clear sensitive fields and report deleted image/raw-page counts for an eligible listing', async () => {
    db = makeDb(makeListing())

    const result = await anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')

    expect(result.outcome).toBe('applied')
    expect(result.fieldsCleared).toEqual([
      'dealerPhone',
      'dealerName',
      'description',
      'zip',
      'images',
      'cardImages',
    ])
    expect(result.imagesDeleted).toBe(2)
    expect(result.rawPagesDeleted).toBe(1)
    expect(db.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'listing-1' },
        data: expect.objectContaining({
          dealerPhone: null,
          dealerName: null,
          description: null,
          zip: null,
          images: [],
          cardImages: [],
        }),
      }),
    )
  })

  it('should call syncListings so the listing is removed from the search index', async () => {
    db = makeDb(makeListing())

    await anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')

    expect(syncListings).toHaveBeenCalledWith(['listing-1'], db, {})
  })

  it('should still apply the anonymization when syncListings fails', async () => {
    db = makeDb(makeListing())
    vi.mocked(syncListings).mockRejectedValueOnce(new Error('Meilisearch unavailable'))

    const result = await anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')

    expect(result.outcome).toBe('applied')
  })

  it('should delete raw pages for both sourceUrl and buyerUrl when they differ', async () => {
    db = makeDb(makeListing({ sourceUrl: 'https://example.com/a', buyerUrl: 'https://example.com/b' }))

    await anonymizePrivateSellerListing(db as never, {} as never, 'listing-1')

    expect(db.rawPage.deleteMany).toHaveBeenCalledWith({
      where: { url: { in: ['https://example.com/a', 'https://example.com/b'] } },
    })
  })
})
