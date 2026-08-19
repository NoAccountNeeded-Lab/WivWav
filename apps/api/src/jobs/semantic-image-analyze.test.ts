import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wivwav/db', () => ({ getDb: vi.fn() }))
vi.mock('../images/image-hasher.js', () => ({ hashImage: vi.fn() }))
vi.mock('../images/semantic-image-analysis.js', () => ({
  analyzeListingImage: vi.fn(),
  CURRENT_SEMANTIC_ANALYSIS_VERSION: 1,
}))

import { getDb } from '@wivwav/db'
import { hashImage } from '../images/image-hasher.js'
import { analyzeListingImage } from '../images/semantic-image-analysis.js'
import { runSemanticImageAnalyzeJob } from './semantic-image-analyze.js'
import type { ImageAnalysisProvider } from '../images/image-analysis-provider.js'

const stubProvider: ImageAnalysisProvider = {
  name: 'stub',
  model: 'stub-vision-1',
  analyze: vi.fn(),
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    listingImage: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  }
}

const baseImage = {
  id: 'img-1',
  kind: 'vehicle_photo' as const,
  normalizedUrl: 'https://source.example.com/photo-1.jpg',
  semanticAnalysisVersion: null as number | null,
  cluster: null as { isPlaceholder: boolean; crossVehicle: boolean } | null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runSemanticImageAnalyzeJob', () => {
  it('skips when the image no longer exists', async () => {
    const db = makeDb()
    vi.mocked(getDb).mockReturnValue(db as never)

    await runSemanticImageAnalyzeJob({ listingImageId: 'missing' }, undefined, stubProvider)

    expect(hashImage).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('skips a placeholder-cluster image', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue({
          ...baseImage,
          cluster: { isPlaceholder: true, crossVehicle: false },
        }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider)

    expect(hashImage).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('skips a cross-vehicle-cluster image', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue({
          ...baseImage,
          cluster: { isPlaceholder: false, crossVehicle: true },
        }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider)

    expect(hashImage).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('skips a non-vehicle_photo image', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue({ ...baseImage, kind: 'site_chrome' }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider)

    expect(hashImage).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('skips an image already at the current semantic version', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue({ ...baseImage, semanticAnalysisVersion: 1 }),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)

    await runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider)

    expect(hashImage).not.toHaveBeenCalled()
    expect(analyzeListingImage).not.toHaveBeenCalled()
  })

  it('downloads and analyzes an eligible, stale image', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue(baseImage),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(hashImage).mockResolvedValue({
      ok: true,
      exactHash: 'sha256-abc',
      pHash: 'phash-abc',
      contentType: 'image/jpeg',
      byteSize: 3,
      bytes: Buffer.from([1, 2, 3]),
    })
    vi.mocked(analyzeListingImage).mockResolvedValue({ status: 'success' } as never)

    await runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider)

    expect(hashImage).toHaveBeenCalledWith(baseImage.normalizedUrl, { keepBytes: true })
    expect(analyzeListingImage).toHaveBeenCalledWith(db, stubProvider, {
      listingImageId: baseImage.id,
      contentHash: 'sha256-abc',
      imageBytes: Buffer.from([1, 2, 3]),
      contentType: 'image/jpeg',
    })
  })

  it('throws on download failure so BullMQ can retry, without calling analyzeListingImage', async () => {
    const db = makeDb({
      listingImage: {
        findUnique: vi.fn().mockResolvedValue(baseImage),
      },
    })
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.mocked(hashImage).mockResolvedValue({ ok: false, kind: 'timeout' })

    await expect(
      runSemanticImageAnalyzeJob({ listingImageId: baseImage.id }, undefined, stubProvider),
    ).rejects.toThrow()

    expect(analyzeListingImage).not.toHaveBeenCalled()
  })
})
