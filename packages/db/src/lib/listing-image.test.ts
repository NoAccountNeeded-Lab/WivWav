import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/index.js'
import {
  findCrossVehicleClusters,
  findImagesByExactHash,
  findImagesWithinHammingDistance,
  findListingImages,
  findPlaceholderClusters,
  ImageKind,
  upsertImageCluster,
  upsertListingImage,
} from './listing-image.js'

function makeDb() {
  const listingImage = { upsert: vi.fn().mockResolvedValue({ id: 'i' }), findMany: vi.fn().mockResolvedValue([]) }
  const imageCluster = { upsert: vi.fn().mockResolvedValue({ id: 'c' }), findMany: vi.fn().mockResolvedValue([]) }
  const $queryRaw = vi.fn().mockResolvedValue([])
  return { db: { listingImage, imageCluster, $queryRaw } as unknown as PrismaClient, listingImage, imageCluster, $queryRaw }
}

describe('upsertListingImage', () => {
  it('upserts by (listingId, originalUrl) and applies defaults', async () => {
    const { db, listingImage } = makeDb()
    await upsertListingImage(db, { listingId: 'L', originalUrl: 'u', normalizedUrl: 'n', position: 2 })
    const arg = listingImage.upsert.mock.calls[0]?.[0]
    expect(arg.where).toEqual({ listingId_originalUrl: { listingId: 'L', originalUrl: 'u' } })
    expect(arg.create).toMatchObject({
      listingId: 'L',
      originalUrl: 'u',
      normalizedUrl: 'n',
      position: 2,
      kind: ImageKind.vehicle_photo,
      widthPx: null,
      heightPx: null,
      exactHash: null,
      pHash: null,
      pHashInt: null,
      analysisVersion: 1,
      clusterId: null,
    })
    expect(arg.update).not.toHaveProperty('listingId')
    expect(arg.update.kind).toBe(ImageKind.vehicle_photo)
  })

  it('dual-writes pHashInt derived from pHash', async () => {
    const { db, listingImage } = makeDb()
    await upsertListingImage(db, {
      listingId: 'L', originalUrl: 'u', normalizedUrl: 'n', position: 0,
      pHash: 'ffffffffffffffff',
    })
    const arg = listingImage.upsert.mock.calls[0]?.[0]
    expect(arg.create.pHash).toBe('ffffffffffffffff')
    expect(arg.create.pHashInt).toBe(BigInt(-1))
    expect(arg.update.pHashInt).toBe(BigInt(-1))
  })

  it('rejects a malformed pHash instead of persisting a disagreeing pair', async () => {
    const { db } = makeDb()
    await expect(
      upsertListingImage(db, {
        listingId: 'L', originalUrl: 'u', normalizedUrl: 'n', position: 0,
        pHash: 'not-a-hash',
      }),
    ).rejects.toThrow()
  })

  it('passes explicit values through', async () => {
    const { db, listingImage } = makeDb()
    await upsertListingImage(db, {
      listingId: 'L', originalUrl: 'u', normalizedUrl: 'n', position: 0,
      widthPx: 640, heightPx: 480, exactHash: 'e', pHash: '0000000000000001', analysisVersion: 3, clusterId: 'c1',
    })
    expect(listingImage.upsert.mock.calls[0]?.[0].update).toMatchObject({
      widthPx: 640, heightPx: 480, exactHash: 'e', pHash: '0000000000000001', pHashInt: BigInt(1), analysisVersion: 3, clusterId: 'c1',
    })
  })
})

describe('upsertImageCluster', () => {
  it('upserts by (clusterType, representativeHash) with defaults', async () => {
    const { db, imageCluster } = makeDb()
    await upsertImageCluster(db, {
      clusterType: 'exact', representativeHash: 'h', listingCount: 2, sourceCount: 1,
      vehicleCount: 1, crossVehicle: false, isPlaceholder: true,
    })
    const arg = imageCluster.upsert.mock.calls[0]?.[0]
    expect(arg.where).toEqual({ clusterType_representativeHash: { clusterType: 'exact', representativeHash: 'h' } })
    expect(arg.create).toMatchObject({ reasonCode: null, analysisVersion: 1, isPlaceholder: true })
    expect(arg.update).toMatchObject({ listingCount: 2, reasonCode: null })
  })
})

describe('findImagesWithinHammingDistance', () => {
  it('issues a single bit_count/xor query with the signed hash int and threshold', async () => {
    const { db, $queryRaw } = makeDb()
    await findImagesWithinHammingDistance(db, 'ffffffffffffffff', 10)

    expect($queryRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = $queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?')
    expect(sql).toContain('bit_count')
    expect(sql).toContain('"listing_image"."pHashInt"')
    expect(sql).toContain('"listing_image"."pHashInt" IS NOT NULL')
    // Bind order: hash, ids (twice: IS NULL guard + ANY), hash, threshold, limit.
    // Signed reinterpretation of 0xffff…: both xor operands carry it.
    expect(values).toEqual([BigInt(-1), null, null, BigInt(-1), 10, null])
  })

  it('passes limit through as a bound parameter', async () => {
    const { db, $queryRaw } = makeDb()
    await findImagesWithinHammingDistance(db, '0000000000000001', 10, { limit: 25 })

    const [, ...values] = $queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(values).toEqual([BigInt(1), null, null, BigInt(1), 10, 25])
  })

  it('passes ids through as a bound parameter for both the guard and the ANY filter', async () => {
    const { db, $queryRaw } = makeDb()
    const ids = ['img-a', 'img-b']
    await findImagesWithinHammingDistance(db, '0000000000000001', 10, { ids })

    const [, ...values] = $queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(values).toEqual([BigInt(1), ids, ids, BigInt(1), 10, null])
  })

  it('rejects a malformed query hash before touching the database', async () => {
    const { db, $queryRaw } = makeDb()
    await expect(findImagesWithinHammingDistance(db, 'xyz', 10)).rejects.toThrow()
    expect($queryRaw).not.toHaveBeenCalled()
  })
})

describe('finders', () => {
  it('query with the expected filters and ordering', async () => {
    const { db, listingImage, imageCluster } = makeDb()
    await findListingImages(db, 'L')
    await findImagesByExactHash(db, 'h')
    await findPlaceholderClusters(db)
    await findCrossVehicleClusters(db)
    expect(listingImage.findMany).toHaveBeenNthCalledWith(1, { where: { listingId: 'L' }, orderBy: { position: 'asc' } })
    expect(listingImage.findMany).toHaveBeenNthCalledWith(2, { where: { exactHash: 'h' }, orderBy: { observedAt: 'asc' } })
    expect(imageCluster.findMany).toHaveBeenNthCalledWith(1, { where: { isPlaceholder: true }, orderBy: { listingCount: 'desc' } })
    expect(imageCluster.findMany).toHaveBeenNthCalledWith(2, { where: { crossVehicle: true }, orderBy: { vehicleCount: 'desc' } })
  })
})
