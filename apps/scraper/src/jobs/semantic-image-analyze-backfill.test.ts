import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))
vi.mock('../images/semantic-analysis-eligibility.js', () => ({
  findEligibleImagesForSemanticAnalysis: vi.fn(),
}))

import { getDb } from '@wivwav/db'
import { findEligibleImagesForSemanticAnalysis } from '../images/semantic-analysis-eligibility.js'
import { runSemanticImageAnalyzeBackfill } from './semantic-image-analyze-backfill.js'

function makeDb() {
  return { $disconnect: vi.fn().mockResolvedValue(undefined) }
}

const eligibleImages = [
  { id: 'img-1', listingId: 'listing-1', originalUrl: 'u1', normalizedUrl: 'u1' },
  { id: 'img-2', listingId: 'listing-2', originalUrl: 'u2', normalizedUrl: 'u2' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDb).mockReturnValue(makeDb() as never)
})

describe('runSemanticImageAnalyzeBackfill', () => {
  it('report mode counts eligible images and enqueues nothing', async () => {
    vi.mocked(findEligibleImagesForSemanticAnalysis).mockResolvedValue(eligibleImages)
    const queue = { add: vi.fn() }

    const report = await runSemanticImageAnalyzeBackfill({ apply: false }, queue as never)

    expect(report.eligible).toBe(2)
    expect(report.enqueued).toBe(0)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('apply mode enqueues one job per eligible image', async () => {
    vi.mocked(findEligibleImagesForSemanticAnalysis).mockResolvedValue(eligibleImages)
    const queue = { add: vi.fn().mockResolvedValue('job-id') }

    const report = await runSemanticImageAnalyzeBackfill({ apply: true }, queue as never)

    expect(report.enqueued).toBe(2)
    expect(queue.add).toHaveBeenCalledTimes(2)
    expect(queue.add).toHaveBeenCalledWith(
      { listingImageId: 'img-1' },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    )
    expect(queue.add).toHaveBeenCalledWith(
      { listingImageId: 'img-2' },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    )
  })

  it('apply mode with no eligible images enqueues nothing', async () => {
    vi.mocked(findEligibleImagesForSemanticAnalysis).mockResolvedValue([])
    const queue = { add: vi.fn() }

    const report = await runSemanticImageAnalyzeBackfill({ apply: true }, queue as never)

    expect(report.eligible).toBe(0)
    expect(report.enqueued).toBe(0)
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('passes sourceId and limit through to the eligibility scan and reflects them in the report', async () => {
    vi.mocked(findEligibleImagesForSemanticAnalysis).mockResolvedValue([eligibleImages[0]!])

    const report = await runSemanticImageAnalyzeBackfill({ apply: false, sourceId: 'src-1', limit: 5 })

    expect(findEligibleImagesForSemanticAnalysis).toHaveBeenCalledWith(expect.anything(), {
      sourceId: 'src-1',
      limit: 5,
    })
    expect(report.scopedToSourceId).toBe('src-1')
    expect(report.limited).toBe(5)
  })
})
