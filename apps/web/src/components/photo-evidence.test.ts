import { describe, it, expect } from 'vitest'
import { buildPhotoEvidence, type PhotoSemanticEvidence } from './photo-evidence'

function rampEvidence(overrides: Partial<PhotoSemanticEvidence> = {}): PhotoSemanticEvidence {
  return {
    imageId: 'image-1',
    originalUrl: 'https://dealer.example.com/ramp.jpg',
    normalizedUrl: 'https://dealer.example.com/ramp.jpg',
    position: 0,
    claims: [{ field: 'rampType', claimedValue: 'fold_out', confidence: 0.92 }],
    ...overrides,
  }
}

describe('buildPhotoEvidence', () => {
  it('returns all-null arrays and no labels when there is no evidence', () => {
    const result = buildPhotoEvidence(['https://a.example.com/1.jpg', 'https://a.example.com/2.jpg'], undefined)
    expect(result.imageAlts).toEqual([null, null])
    expect(result.imageCategories).toEqual([null, null])
    expect(result.categoryLabels).toEqual({})
  })

  it('returns all-null arrays when semanticEvidence is an empty array', () => {
    const result = buildPhotoEvidence(['https://a.example.com/1.jpg'], [])
    expect(result.imageAlts).toEqual([null])
    expect(result.imageCategories).toEqual([null])
  })

  it('matches evidence to images by exact originalUrl equality', () => {
    const images = ['https://dealer.example.com/side.jpg', 'https://dealer.example.com/ramp.jpg']
    const result = buildPhotoEvidence(images, [rampEvidence()])

    expect(result.imageAlts[0]).toBeNull()
    expect(result.imageAlts[1]).toBe('Fold-out wheelchair ramp')
    expect(result.imageCategories[0]).toBeNull()
    expect(result.imageCategories[1]).toEqual(['ramp'])
    expect(result.categoryLabels).toEqual({ ramp: 'Ramp' })
  })

  it('leaves an image untouched when its URL has no matching evidence entry', () => {
    const images = ['https://dealer.example.com/other.jpg']
    const result = buildPhotoEvidence(images, [rampEvidence()])
    expect(result.imageAlts).toEqual([null])
    expect(result.imageCategories).toEqual([null])
  })

  it('produces distinct alt text for each allowlisted ramp claim value', () => {
    const images = ['https://dealer.example.com/ramp.jpg']
    expect(
      buildPhotoEvidence(images, [
        rampEvidence({ claims: [{ field: 'rampType', claimedValue: 'in_floor', confidence: 0.9 }] }),
      ]).imageAlts[0],
    ).toBe('In-floor wheelchair ramp')
    expect(
      buildPhotoEvidence(images, [
        rampEvidence({ claims: [{ field: 'rampType', claimedValue: 'fold_in', confidence: 0.9 }] }),
      ]).imageAlts[0],
    ).toBe('Fold-in wheelchair ramp')
  })

  it('ignores claim fields that are not in the known category map', () => {
    const images = ['https://dealer.example.com/ramp.jpg']
    const result = buildPhotoEvidence(images, [
      rampEvidence({ claims: [{ field: 'conversionType', claimedValue: 'side_entry', confidence: 0.99 }] }),
    ])
    expect(result.imageAlts[0]).toBeNull()
    expect(result.imageCategories[0]).toBeNull()
    expect(result.categoryLabels).toEqual({})
  })

  it('dedupes category ids and label entries across multiple images in the same category', () => {
    const images = ['https://dealer.example.com/ramp1.jpg', 'https://dealer.example.com/ramp2.jpg']
    const result = buildPhotoEvidence(images, [
      rampEvidence({ imageId: 'img-1', originalUrl: images[0]!, normalizedUrl: images[0]! }),
      rampEvidence({ imageId: 'img-2', originalUrl: images[1]!, normalizedUrl: images[1]! }),
    ])
    expect(result.imageCategories[0]).toEqual(['ramp'])
    expect(result.imageCategories[1]).toEqual(['ramp'])
    expect(Object.keys(result.categoryLabels)).toEqual(['ramp'])
  })
})
