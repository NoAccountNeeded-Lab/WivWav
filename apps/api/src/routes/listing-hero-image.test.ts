import { describe, expect, it } from 'vitest'
import type { ListingImageWithSemanticAnalyses } from '../repositories/index.js'
import { promoteHeroImage } from './listing-hero-image.js'

const urls = [
  'https://dealer.example.com/first.jpg',
  'https://dealer.example.com/second.jpg',
  'https://dealer.example.com/third.jpg',
]

function image(
  id: string,
  position: number,
  confidence: number,
  overrides: Partial<ListingImageWithSemanticAnalyses> = {},
): ListingImageWithSemanticAnalyses {
  const originalUrl = urls[position] ?? `https://dealer.example.com/${id}.jpg`
  const exactHash = `hash-${id}`
  return {
    id,
    listingId: 'listing-1',
    originalUrl,
    normalizedUrl: originalUrl,
    position,
    kind: 'vehicle_photo',
    exactHash,
    semanticAnalysisVersion: 1,
    cluster: null,
    semanticAnalyses: [{
      id: `analysis-${id}`,
      listingImageId: id,
      contentHash: exactHash,
      semanticAnalysisVersion: 1,
      provider: 'test',
      model: 'test',
      schemaVersion: '1',
      status: 'success',
      errorCode: null,
      errorMessage: null,
      labels: [{ label: 'exterior', confidence }],
      fieldClaims: [],
      altText: null,
      summary: null,
      observedAt: new Date('2026-07-21T00:00:00Z'),
      createdAt: new Date('2026-07-21T00:00:00Z'),
    }],
    ...overrides,
  }
}

describe('promoteHeroImage', () => {
  it('should promote the highest-scored non-first exterior image', () => {
    const result = promoteHeroImage(urls, [image('first', 0, 0.9), image('second', 1, 0.98)], 0.85)

    expect(result).toEqual([urls[1], urls[0], urls[2]])
  })

  it('should use gallery position and then id as deterministic score tie breakers', () => {
    const tiedUrls = [urls[0]!, 'https://dealer.example.com/a.jpg', 'https://dealer.example.com/b.jpg', urls[2]!]
    const candidates = [
      image('z', 2, 0.95),
      image('b', 1, 0.95, { originalUrl: tiedUrls[2]!, normalizedUrl: tiedUrls[2]! }),
      image('a', 1, 0.95, { originalUrl: tiedUrls[1]!, normalizedUrl: tiedUrls[1]! }),
    ]

    expect(promoteHeroImage(tiedUrls, candidates, 0.85)[0]).toBe(tiedUrls[1])
  })

  it('should accept a score equal to the configured confidence threshold', () => {
    expect(promoteHeroImage(urls, [image('second', 1, 0.9)], 0.9)[0]).toBe(urls[1])
  })

  it('should reject a score below the configured confidence threshold', () => {
    const original = [...urls]

    expect(promoteHeroImage(original, [image('second', 1, 0.899)], 0.9)).toBe(original)
  })

  it('should reject stale, failed, or non-exterior semantic analysis', () => {
    const staleVersion = image('second', 1, 0.99)
    staleVersion.semanticAnalyses[0]!.semanticAnalysisVersion = 0
    const staleHash = image('third', 2, 0.99)
    staleHash.semanticAnalyses[0]!.contentHash = 'old-hash'
    const failed = image('second', 1, 0.99)
    failed.semanticAnalyses[0]!.status = 'error'
    const nonExterior = image('third', 2, 0.99)
    nonExterior.semanticAnalyses[0]!.labels = [{ label: 'interior', confidence: 0.99 }]
    const original = [...urls]

    expect(promoteHeroImage(original, [staleVersion, staleHash, failed, nonExterior], 0.85)).toBe(original)
  })

  it.each([
    { crossVehicle: true, isPlaceholder: false },
    { crossVehicle: false, isPlaceholder: true },
  ])('should reject an integrity-ineligible image with flags %j', (cluster) => {
    const original = [...urls]
    const candidate = image('second', 1, 0.99, { cluster })

    expect(promoteHeroImage(original, [candidate], 0.85)).toBe(original)
  })

  it('should preserve the exact original image array and order when no candidate is eligible', () => {
    const original = [...urls]
    const before = JSON.stringify(original)

    const result = promoteHeroImage(original, [], 0.85)

    expect(result).toBe(original)
    expect(JSON.stringify(result)).toBe(before)
  })

  it('should ignore analyzed URLs that are no longer in the current gallery', () => {
    const original = [...urls]
    const removed = image('removed', 9, 0.99)

    expect(promoteHeroImage(original, [removed], 0.85)).toBe(original)
  })
})
