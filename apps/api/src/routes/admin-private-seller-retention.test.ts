import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({
  appendPrivateSellerDeletionAuditEntry: vi.fn().mockResolvedValue(undefined),
  listPrivateSellerDeletionAuditEntries: vi.fn().mockResolvedValue([]),
}))
vi.mock('../services/private-seller-retention.js', async () => {
  const actual = await vi.importActual<typeof import('../services/private-seller-retention.js')>(
    '../services/private-seller-retention.js',
  )
  return { ...actual, anonymizePrivateSellerListing: vi.fn() }
})

import { appendPrivateSellerDeletionAuditEntry, listPrivateSellerDeletionAuditEntries } from '@wivwav/db'
import {
  anonymizePrivateSellerListing,
  ListingNotFoundError,
  NotPrivateSellerError,
} from '../services/private-seller-retention.js'
import { adminPrivateSellerRetentionRoutes } from './admin-private-seller-retention.js'

function buildTestApp() {
  const app = Fastify()
  void app.register(sensible)
  const db = {} as never
  const meili = {} as never
  void app.register(adminPrivateSellerRetentionRoutes, { db, meili })
  return { app, db }
}

describe('POST /listings/:id/delete', () => {
  beforeEach(() => {
    vi.mocked(anonymizePrivateSellerListing).mockReset()
    vi.mocked(appendPrivateSellerDeletionAuditEntry).mockClear()
  })

  it('should anonymize the listing and record an audit entry on success', async () => {
    vi.mocked(anonymizePrivateSellerListing).mockResolvedValue({
      listingId: 'listing-1',
      outcome: 'applied',
      fieldsCleared: ['dealerPhone', 'description'],
      imagesDeleted: 3,
      rawPagesDeleted: 1,
    })
    const { app } = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/listings/listing-1/delete',
      payload: { reason: 'Seller requested removal', requestedBy: 'ops-operator' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        listingId: 'listing-1',
        outcome: 'applied',
        fieldsCleared: ['dealerPhone', 'description'],
        imagesDeleted: 3,
        rawPagesDeleted: 1,
      },
    })
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      'listing-1',
      expect.objectContaining({
        action: 'operator-request',
        outcome: 'applied',
        reason: 'Seller requested removal',
        requestedBy: 'ops-operator',
      }),
    )
  })

  it('should return 404 when the listing does not exist', async () => {
    vi.mocked(anonymizePrivateSellerListing).mockRejectedValue(new ListingNotFoundError('missing'))
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/listings/missing/delete', payload: {} })

    expect(res.statusCode).toBe(404)
  })

  it('should return 422 when the listing is not a private-seller listing', async () => {
    vi.mocked(anonymizePrivateSellerListing).mockRejectedValue(new NotPrivateSellerError('listing-1'))
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/listings/listing-1/delete', payload: {} })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ error: { code: 'NOT_PRIVATE_SELLER' } })
  })

  it('should record a failed audit entry and propagate the error for an unexpected failure', async () => {
    vi.mocked(anonymizePrivateSellerListing).mockRejectedValue(new Error('DB unavailable'))
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/listings/listing-1/delete', payload: {} })

    expect(res.statusCode).toBe(500)
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      'listing-1',
      expect.objectContaining({ action: 'operator-request', outcome: 'failed', errorMessage: 'DB unavailable' }),
    )
  })

  it('should treat a missing request body as no reason/requestedBy', async () => {
    vi.mocked(anonymizePrivateSellerListing).mockResolvedValue({
      listingId: 'listing-1',
      outcome: 'applied',
      fieldsCleared: [],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    })
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/listings/listing-1/delete' })

    expect(res.statusCode).toBe(200)
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      expect.anything(),
      'listing-1',
      expect.objectContaining({ reason: null, requestedBy: null }),
    )
  })
})

describe('GET /listings/:id/audit', () => {
  it('should return the audit history for a listing', async () => {
    vi.mocked(listPrivateSellerDeletionAuditEntries).mockResolvedValue([
      {
        listingId: 'listing-1',
        action: 'automated-retention',
        outcome: 'applied',
        fieldsCleared: ['description'],
        reason: null,
        requestedBy: null,
        errorMessage: null,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    const { app } = buildTestApp()

    const res = await app.inject({ method: 'GET', url: '/listings/listing-1/audit' })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })
})
