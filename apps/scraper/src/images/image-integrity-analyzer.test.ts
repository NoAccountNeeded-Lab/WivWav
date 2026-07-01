import { describe, it, expect } from 'vitest'
import {
  analyzeImages,
  heroEligibleImages,
  classifyReuseContext,
  PLACEHOLDER_LISTING_THRESHOLD,
  type AnalyzerImage,
} from './image-integrity-analyzer.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeImage(overrides: Partial<AnalyzerImage> = {}): AnalyzerImage {
  return {
    id: `img-${Math.random().toString(36).slice(2)}`,
    listingId: 'listing-1',
    sourceId: 'source-1',
    vehicleId: null,
    vin: null,
    normalizedUrl: 'https://cdn.example.com/vehicle-photo.jpg',
    exactHash: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    pHash: '0000000000000001',
    position: 0,
    ...overrides,
  }
}

// ── Exact duplicate detection ─────────────────────────────────────────────────

describe('analyzeImages — exact duplicates', () => {
  it('should group two images with the same exact hash into one cluster', () => {
    const hash = 'aaaa000000000000000000000000000000000000000000000000000000000000'
    const imgA = makeImage({ id: 'a', listingId: 'L1', exactHash: hash, pHash: '0000000000000001' })
    const imgB = makeImage({ id: 'b', listingId: 'L2', exactHash: hash, pHash: '0000000000000002' })

    const result = analyzeImages([imgA, imgB])
    const exactClusters = result.clusters.filter((c) => c.clusterType === 'exact')

    expect(exactClusters).toHaveLength(1)
    expect(exactClusters[0]!.memberIds).toContain('a')
    expect(exactClusters[0]!.memberIds).toContain('b')
  })

  it('should report 2 listing count for a 2-listing exact cluster', () => {
    const hash = 'bbbb000000000000000000000000000000000000000000000000000000000000'
    const imgs = [
      makeImage({ id: 'a', listingId: 'L1', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', exactHash: hash }),
    ]
    const result = analyzeImages(imgs)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(cluster.listingCount).toBe(2)
  })

  it('should NOT create a cluster for a unique (single-occurrence) exact hash', () => {
    const imgA = makeImage({ id: 'a', exactHash: 'uniquehash' + '0'.repeat(56) })
    const result = analyzeImages([imgA])
    expect(result.clusters.filter((c) => c.clusterType === 'exact')).toHaveLength(0)
  })

  it('should classify exact duplicate images as vehicle_photo when below placeholder threshold', () => {
    const hash = 'cccc000000000000000000000000000000000000000000000000000000000000'
    const imgs = [
      makeImage({ id: 'a', listingId: 'L1', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', exactHash: hash }),
    ]
    const result = analyzeImages(imgs)
    const kinds = result.images.map((img) => img.kind)
    expect(kinds.every((k) => k === 'vehicle_photo')).toBe(true)
  })
})

// ── Near-duplicate detection ──────────────────────────────────────────────────

describe('analyzeImages — near-duplicate detection', () => {
  it('should group two images with pHash distance ≤ threshold into a near cluster', () => {
    // pHash values 1 apart in Hamming distance (differ in last bit only)
    const imgA = makeImage({ id: 'a', listingId: 'L1', exactHash: null, pHash: '0000000000000000' })
    const imgB = makeImage({ id: 'b', listingId: 'L2', exactHash: null, pHash: '0000000000000001' })
    const result = analyzeImages([imgA, imgB])
    const nearClusters = result.clusters.filter((c) => c.clusterType === 'near')
    expect(nearClusters).toHaveLength(1)
    expect(nearClusters[0]!.memberIds).toContain('a')
    expect(nearClusters[0]!.memberIds).toContain('b')
  })

  it('should NOT cluster two images with pHash distance > threshold', () => {
    // All bits flipped = Hamming distance 64
    const imgA = makeImage({ id: 'a', listingId: 'L1', exactHash: null, pHash: '0000000000000000' })
    const imgB = makeImage({ id: 'b', listingId: 'L2', exactHash: null, pHash: 'ffffffffffffffff' })
    const result = analyzeImages([imgA, imgB])
    const nearClusters = result.clusters.filter((c) => c.clusterType === 'near')
    expect(nearClusters).toHaveLength(0)
  })

  it('should skip near-duplicate pass for images already in an exact cluster', () => {
    const hash = 'dddd000000000000000000000000000000000000000000000000000000000000'
    // Two images share exact hash; they also have similar pHashes
    const imgA = makeImage({ id: 'a', listingId: 'L1', exactHash: hash, pHash: '0000000000000000' })
    const imgB = makeImage({ id: 'b', listingId: 'L2', exactHash: hash, pHash: '0000000000000001' })
    const result = analyzeImages([imgA, imgB])
    // Should only produce an exact cluster, not also a near cluster
    expect(result.clusters.filter((c) => c.clusterType === 'near')).toHaveLength(0)
    expect(result.clusters.filter((c) => c.clusterType === 'exact')).toHaveLength(1)
  })
})

// ── Placeholder classification ────────────────────────────────────────────────

describe('analyzeImages — placeholder classification', () => {
  it('should flag a cluster as placeholder when it spans > PLACEHOLDER_LISTING_THRESHOLD listings', () => {
    const hash = 'eeee000000000000000000000000000000000000000000000000000000000000'
    const images = Array.from({ length: PLACEHOLDER_LISTING_THRESHOLD + 1 }, (_, i) =>
      makeImage({ id: `img-${i}`, listingId: `L${i}`, exactHash: hash }),
    )
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(cluster.isPlaceholder).toBe(true)
  })

  it('should NOT flag a cluster as placeholder at exactly the threshold', () => {
    const hash = 'ffff000000000000000000000000000000000000000000000000000000000000'
    const images = Array.from({ length: PLACEHOLDER_LISTING_THRESHOLD }, (_, i) =>
      makeImage({ id: `img-${i}`, listingId: `L${i}`, exactHash: hash }),
    )
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')
    expect(cluster?.isPlaceholder ?? false).toBe(false)
  })

  it('should classify placeholder cluster member images as placeholder kind', () => {
    const hash = '1111000000000000000000000000000000000000000000000000000000000000'
    const images = Array.from({ length: PLACEHOLDER_LISTING_THRESHOLD + 1 }, (_, i) =>
      makeImage({ id: `img-${i}`, listingId: `L${i}`, exactHash: hash }),
    )
    const result = analyzeImages(images)
    for (const img of result.images) {
      expect(img.kind).toBe('placeholder')
    }
  })
})

// ── Legitimate same-vehicle reuse ─────────────────────────────────────────────

describe('analyzeImages — same-vehicle reuse', () => {
  it('should not flag as cross-vehicle when all members share the same vehicleId', () => {
    const hash = '2222000000000000000000000000000000000000000000000000000000000000'
    const images = [
      makeImage({ id: 'a', listingId: 'L1', vehicleId: 'V1', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', vehicleId: 'V1', exactHash: hash }),
    ]
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(cluster.crossVehicle).toBe(false)
    expect(classifyReuseContext(cluster)).toBe('same_vehicle')
  })
})

// ── Cross-VIN / suspicious reuse ─────────────────────────────────────────────

describe('analyzeImages — cross-vehicle reuse', () => {
  it('should flag cross-vehicle when cluster spans two different vehicleIds', () => {
    const hash = '3333000000000000000000000000000000000000000000000000000000000000'
    const images = [
      makeImage({ id: 'a', listingId: 'L1', vehicleId: 'V1', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', vehicleId: 'V2', exactHash: hash }),
    ]
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(cluster.crossVehicle).toBe(true)
    expect(classifyReuseContext(cluster)).toBe('cross_vehicle')
  })

  it('should use VIN as vehicle-group key when vehicleId is null', () => {
    const hash = '4444000000000000000000000000000000000000000000000000000000000000'
    const images = [
      makeImage({ id: 'a', listingId: 'L1', vehicleId: null, vin: '1HGCM82633A004352', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', vehicleId: null, vin: '2T1BURHE0JC013820', exactHash: hash }),
    ]
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(cluster.crossVehicle).toBe(true)
  })

  it('should classify no-vehicle-context when all members have null vehicleId and VIN', () => {
    const hash = '5555000000000000000000000000000000000000000000000000000000000000'
    const images = [
      makeImage({ id: 'a', listingId: 'L1', vehicleId: null, vin: null, exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', vehicleId: null, vin: null, exactHash: hash }),
    ]
    const result = analyzeImages(images)
    const cluster = result.clusters.find((c) => c.clusterType === 'exact')!
    expect(classifyReuseContext(cluster)).toBe('no_vehicle_context')
  })
})

// ── Site-chrome classification ────────────────────────────────────────────────

describe('analyzeImages — site-chrome classification', () => {
  it('should classify images with logo URL paths as site_chrome', () => {
    const img = makeImage({ id: 'logo', normalizedUrl: 'https://example.com/assets/logo.png' })
    const result = analyzeImages([img])
    const found = result.images.find((i) => i.id === 'logo')!
    expect(found.kind).toBe('site_chrome')
    expect(found.clusterId).toBeNull()
  })

  it('should classify data URI images as site_chrome', () => {
    const img = makeImage({ id: 'data', normalizedUrl: 'data:image/png;base64,abc' })
    const result = analyzeImages([img])
    expect(result.images.find((i) => i.id === 'data')!.kind).toBe('site_chrome')
  })
})

// ── Excluded images (download failures) ──────────────────────────────────────

describe('analyzeImages — excluded images', () => {
  it('should classify images with no hashes as excluded', () => {
    const img = makeImage({
      id: 'no-hash',
      normalizedUrl: 'https://cdn.example.com/vehicle-photo.jpg',
      exactHash: null,
      pHash: null,
    })
    const result = analyzeImages([img])
    expect(result.images.find((i) => i.id === 'no-hash')!.kind).toBe('excluded')
  })
})

// ── Hero eligibility ──────────────────────────────────────────────────────────

describe('heroEligibleImages', () => {
  it('should return vehicle_photo images not in a cross-vehicle cluster', () => {
    const imgs = [
      { id: 'a', kind: 'vehicle_photo' as const, clusterId: null },
      { id: 'b', kind: 'vehicle_photo' as const, clusterId: 'cluster-safe' },
    ]
    const clusters = [
      { id: 'cluster-safe', clusterType: 'exact', representativeHash: 'h', listingCount: 2,
        sourceCount: 1, vehicleCount: 1, crossVehicle: false, isPlaceholder: false,
        reasonCode: null, memberIds: ['b'] },
    ]
    const result = heroEligibleImages(imgs, clusters)
    expect(result.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('should exclude images in cross-vehicle clusters', () => {
    const imgs = [
      { id: 'good', kind: 'vehicle_photo' as const, clusterId: null },
      { id: 'bad', kind: 'vehicle_photo' as const, clusterId: 'cross-cluster' },
    ]
    const clusters = [
      { id: 'cross-cluster', clusterType: 'exact', representativeHash: 'h', listingCount: 3,
        sourceCount: 2, vehicleCount: 2, crossVehicle: true, isPlaceholder: false,
        reasonCode: 'cross vehicle', memberIds: ['bad'] },
    ]
    const result = heroEligibleImages(imgs, clusters)
    expect(result.map((i) => i.id)).toEqual(['good'])
  })

  it('should exclude placeholder kind images', () => {
    const imgs = [
      { id: 'good', kind: 'vehicle_photo' as const, clusterId: null },
      { id: 'ph', kind: 'placeholder' as const, clusterId: 'cluster-ph' },
    ]
    const clusters: never[] = []
    const result = heroEligibleImages(imgs, clusters)
    expect(result.map((i) => i.id)).toEqual(['good'])
  })

  it('should return empty array when all images are suspect (all-suspect gallery)', () => {
    const imgs = [
      { id: 'a', kind: 'placeholder' as const, clusterId: null },
      { id: 'b', kind: 'site_chrome' as const, clusterId: null },
      { id: 'c', kind: 'excluded' as const, clusterId: null },
    ]
    const result = heroEligibleImages(imgs, [])
    expect(result).toHaveLength(0)
  })
})

// ── Job idempotency (same input → same output) ────────────────────────────────

describe('analyzeImages — idempotency', () => {
  it('should produce the same clusters when called twice with the same input', () => {
    const hash = '6666000000000000000000000000000000000000000000000000000000000000'
    const images = [
      makeImage({ id: 'a', listingId: 'L1', exactHash: hash }),
      makeImage({ id: 'b', listingId: 'L2', exactHash: hash }),
    ]
    const r1 = analyzeImages(images)
    const r2 = analyzeImages(images)
    expect(r1.clusters.length).toBe(r2.clusters.length)
    expect(r1.clusters[0]!.id).toBe(r2.clusters[0]!.id)
    expect(r1.images.map((i) => i.kind)).toEqual(r2.images.map((i) => i.kind))
  })
})
