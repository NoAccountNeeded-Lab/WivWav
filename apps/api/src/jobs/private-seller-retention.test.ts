import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({
  getDb: vi.fn(),
  appendPrivateSellerDeletionAuditEntry: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/meili.js', () => ({ getMeiliClient: vi.fn(() => ({})) }))
vi.mock('../services/private-seller-retention.js', async () => {
  const actual = await vi.importActual<typeof import('../services/private-seller-retention.js')>(
    '../services/private-seller-retention.js',
  )
  return { ...actual, anonymizePrivateSellerListing: vi.fn() }
})

import { getDb, appendPrivateSellerDeletionAuditEntry } from '@wivwav/db'
import { anonymizePrivateSellerListing } from '../services/private-seller-retention.js'
import { runPrivateSellerRetentionJob } from './private-seller-retention.js'

function makeDb(candidateBatches: Array<Array<{ id: string }>>) {
  const findMany = vi.fn()
  for (const batch of candidateBatches) findMany.mockResolvedValueOnce(batch)
  findMany.mockResolvedValue([])
  return { listing: { findMany } }
}

describe('runPrivateSellerRetentionJob', () => {
  beforeEach(() => {
    vi.mocked(anonymizePrivateSellerListing).mockReset()
    vi.mocked(appendPrivateSellerDeletionAuditEntry).mockClear()
  })

  it('should do nothing when no gone private-seller listings are past the retention window', async () => {
    const db = makeDb([[]])
    vi.mocked(getDb).mockReturnValue(db as never)

    await runPrivateSellerRetentionJob()

    expect(anonymizePrivateSellerListing).not.toHaveBeenCalled()
  })

  it('should anonymize each candidate and append an applied audit entry', async () => {
    const db = makeDb([[{ id: 'l-1' }, { id: 'l-2' }]])
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(anonymizePrivateSellerListing).mockResolvedValue({
      listingId: 'l-1',
      outcome: 'applied',
      fieldsCleared: ['description'],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    })

    await runPrivateSellerRetentionJob()

    expect(anonymizePrivateSellerListing).toHaveBeenCalledTimes(2)
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      db,
      'l-1',
      expect.objectContaining({ action: 'automated-retention', outcome: 'applied' }),
    )
  })

  it('should not write an audit entry for a listing already anonymized by a concurrent run', async () => {
    const db = makeDb([[{ id: 'l-1' }]])
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(anonymizePrivateSellerListing).mockResolvedValue({
      listingId: 'l-1',
      outcome: 'skipped-already-applied',
      fieldsCleared: [],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    })

    await runPrivateSellerRetentionJob()

    expect(appendPrivateSellerDeletionAuditEntry).not.toHaveBeenCalled()
  })

  it('should continue processing remaining candidates when one anonymization fails', async () => {
    const db = makeDb([[{ id: 'l-1' }, { id: 'l-2' }]])
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(anonymizePrivateSellerListing)
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce({
        listingId: 'l-2',
        outcome: 'applied',
        fieldsCleared: ['description'],
        imagesDeleted: 0,
        rawPagesDeleted: 0,
      })

    await runPrivateSellerRetentionJob()

    expect(anonymizePrivateSellerListing).toHaveBeenCalledTimes(2)
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      db,
      'l-1',
      expect.objectContaining({ action: 'automated-retention', outcome: 'failed', errorMessage: 'DB write failed' }),
    )
    expect(appendPrivateSellerDeletionAuditEntry).toHaveBeenCalledWith(
      db,
      'l-2',
      expect.objectContaining({ outcome: 'applied' }),
    )
  })

  it('should drain multiple batches in one run when the backlog exceeds one batch', async () => {
    const db = makeDb([[{ id: 'l-1' }], [{ id: 'l-2' }]])
    db.listing.findMany.mockReset()
    db.listing.findMany
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `l-${i}` })))
      .mockResolvedValueOnce([{ id: 'l-100' }])
      .mockResolvedValue([])
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(anonymizePrivateSellerListing).mockResolvedValue({
      listingId: 'x',
      outcome: 'applied',
      fieldsCleared: [],
      imagesDeleted: 0,
      rawPagesDeleted: 0,
    })

    await runPrivateSellerRetentionJob()

    expect(anonymizePrivateSellerListing).toHaveBeenCalledTimes(101)
  })
})
