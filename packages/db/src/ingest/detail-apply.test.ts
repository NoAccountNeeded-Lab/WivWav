import { describe, expect, it, vi } from 'vitest'
import { buildListingDetailUpdateData, enqueueRequiredListingResolution } from './detail-apply.js'

function makeDb(alreadyEnqueued = false) {
  return {
    listingObservation: {
      findUnique: vi.fn().mockResolvedValue(alreadyEnqueued ? { id: 'o1' } : null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  }
}

// #1156: every detail write sets publicationStatus='pending', so the enqueue is
// unconditional (unchanged detail, non-accessibility change, retry of an applied write alike).
describe('enqueueRequiredListingResolution', () => {
  it('enqueues with an idempotent job id and records the marker', async () => {
    const db = makeDb()
    const queue = { add: vi.fn().mockResolvedValue('job-1') }
    await enqueueRequiredListingResolution(db as never, queue, { attempts: 3 }, 'l-1', 'raw:1', 'run-1')
    expect(queue.add).toHaveBeenCalledWith(
      { listingId: 'l-1', observationReference: 'raw:1', parentRunId: 'run-1' },
      { attempts: 3, jobId: 'detail-resolution:raw:1' },
    )
    expect(db.listingObservation.upsert).toHaveBeenCalledTimes(1)
  })

  it('does not enqueue a duplicate when the marker already exists (retry of an applied write)', async () => {
    const db = makeDb(true)
    const queue = { add: vi.fn() }
    await enqueueRequiredListingResolution(db as never, queue, {}, 'l-1', 'raw:1')
    expect(queue.add).not.toHaveBeenCalled()
    expect(db.listingObservation.upsert).not.toHaveBeenCalled()
  })

  it('is a no-op without a queue', async () => {
    const db = makeDb()
    await enqueueRequiredListingResolution(db as never, undefined, {}, 'l-1', 'raw:1')
    expect(db.listingObservation.upsert).not.toHaveBeenCalled()
  })

  it('propagates an enqueue failure and leaves no marker so a retry can enqueue again', async () => {
    const db = makeDb()
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis down')) }
    await expect(
      enqueueRequiredListingResolution(db as never, queue, {}, 'l-1', 'raw:1'),
    ).rejects.toThrow('redis down')
    expect(db.listingObservation.upsert).not.toHaveBeenCalled()
  })
})

describe('buildListingDetailUpdateData', () => {
  it('clears detailStaleAt and stamps detailScrapedAt so resolution can decide (#1156)', () => {
    const now = new Date('2026-10-22T00:00:00Z')
    const update = buildListingDetailUpdateData(
      {
        evidence: {
          color: 'missing',
          fuelType: 'missing',
          engine: 'missing',
          transmission: 'missing',
          description: 'missing',
          images: 'missing',
        },
        saleStatus: 'active',
        sourceListedAt: null,
        sourceUpdatedAt: null,
        zip: null,
        dealerPhone: null,
      } as never,
      {} as never,
      {},
      now,
    )
    expect(update).toMatchObject({
      detailScrapedAt: now,
      detailStaleAt: null,
      publicationStatus: 'pending',
    })
  })
})
