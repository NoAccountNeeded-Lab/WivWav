import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/index.js'
import {
  findCrossVehicleClusters,
  findImagesByExactHash,
  findListingImages,
  findPlaceholderClusters,
  ImageKind,
  upsertImageCluster,
  upsertListingImage,
} from './listing-image.js'

function makeDb() {
  const listingImage = { upsert: vi.fn().mockResolvedValue({ id: 'i' }), findMany: vi.fn().mockResolvedValue([]) }
  const imageCluster = { upsert: vi.fn().mockResolvedValue({ id: 'c' }), findMany: vi.fn().mockResolvedValue([]) }
  return { db: { listingImage, imageCluster } as unknown as PrismaClient, listingImage, imageCluster }
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
      analysisVersion: 1,
      clusterId: null,
    })
    expect(arg.update).not.toHaveProperty('listingId')
    expect(arg.update.kind).toBe(ImageKind.vehicle_photo)
  })

  it('passes explicit values through', async () => {
    const { db, listingImage } = makeDb()
    await upsertListingImage(db, {
      listingId: 'L', originalUrl: 'u', normalizedUrl: 'n', position: 0,
      widthPx: 640, heightPx: 480, exactHash: 'e', pHash: 'p', analysisVersion: 3, clusterId: 'c1',
    })
    expect(listingImage.upsert.mock.calls[0]?.[0].update).toMatchObject({
      widthPx: 640, heightPx: 480, exactHash: 'e', pHash: 'p', analysisVersion: 3, clusterId: 'c1',
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
