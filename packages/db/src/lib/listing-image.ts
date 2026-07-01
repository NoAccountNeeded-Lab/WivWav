/**
 * DB helpers for listing_image and image_cluster persistence.
 *
 * Design notes:
 * - All writes are idempotent (upsert by natural key).
 * - Cluster upserts are keyed by (clusterType, representativeHash) — the same
 *   hash pair always maps to the same cluster row.
 * - Image upserts are keyed by (listingId, originalUrl).
 * - Raw image bytes are never stored; only hash strings and metadata.
 */

import type { PrismaClient, ListingImage, ImageCluster } from '../generated/prisma/index.js'
import { ImageKind } from '../generated/prisma/index.js'

export { ImageKind }

export interface ListingImageInput {
  listingId: string
  originalUrl: string
  normalizedUrl: string
  position: number
  kind?: ImageKind
  widthPx?: number | null
  exactHash?: string | null
  heightPx?: number | null
  pHash?: string | null
  analysisVersion?: number
  clusterId?: string | null
}

export interface ImageClusterInput {
  clusterType: string
  representativeHash: string
  listingCount: number
  sourceCount: number
  vehicleCount: number
  crossVehicle: boolean
  isPlaceholder: boolean
  reasonCode?: string | null
  analysisVersion?: number
}

/**
 * Idempotently upsert a listing image record.
 * Natural key: (listingId, originalUrl).
 */
export async function upsertListingImage(
  db: PrismaClient,
  input: ListingImageInput,
): Promise<ListingImage> {
  const data = {
    normalizedUrl: input.normalizedUrl,
    position: input.position,
    kind: input.kind ?? ImageKind.vehicle_photo,
    widthPx: input.widthPx ?? null,
    heightPx: input.heightPx ?? null,
    exactHash: input.exactHash ?? null,
    pHash: input.pHash ?? null,
    analysisVersion: input.analysisVersion ?? 1,
    clusterId: input.clusterId ?? null,
  }

  return db.listingImage.upsert({
    where: {
      listingId_originalUrl: {
        listingId: input.listingId,
        originalUrl: input.originalUrl,
      },
    },
    create: {
      listingId: input.listingId,
      originalUrl: input.originalUrl,
      ...data,
    },
    update: data,
  })
}

/**
 * Idempotently upsert an image cluster record.
 * Natural key: (clusterType, representativeHash) — derived from the cluster id
 * produced by the analyzer ("exact:{hash}" or "near:{hash}").
 */
export async function upsertImageCluster(
  db: PrismaClient,
  input: ImageClusterInput,
): Promise<ImageCluster> {
  const data = {
    listingCount: input.listingCount,
    sourceCount: input.sourceCount,
    vehicleCount: input.vehicleCount,
    crossVehicle: input.crossVehicle,
    isPlaceholder: input.isPlaceholder,
    reasonCode: input.reasonCode ?? null,
    analysisVersion: input.analysisVersion ?? 1,
  }

  return db.imageCluster.upsert({
    where: {
      clusterType_representativeHash: {
        clusterType: input.clusterType,
        representativeHash: input.representativeHash,
      },
    },
    create: {
      clusterType: input.clusterType,
      representativeHash: input.representativeHash,
      ...data,
    },
    update: data,
  })
}

/**
 * Load all ListingImage rows for a listing.
 * Ordered by position asc.
 */
export function findListingImages(
  db: PrismaClient,
  listingId: string,
): Promise<ListingImage[]> {
  return db.listingImage.findMany({
    where: { listingId },
    orderBy: { position: 'asc' },
  })
}

/**
 * Load all ListingImage rows that share an exact hash (byte-identical images).
 */
export function findImagesByExactHash(
  db: PrismaClient,
  exactHash: string,
): Promise<ListingImage[]> {
  return db.listingImage.findMany({
    where: { exactHash },
    orderBy: { observedAt: 'asc' },
  })
}

/**
 * Load all clusters flagged as placeholders.
 */
export function findPlaceholderClusters(db: PrismaClient): Promise<ImageCluster[]> {
  return db.imageCluster.findMany({
    where: { isPlaceholder: true },
    orderBy: { listingCount: 'desc' },
  })
}

/**
 * Load all clusters that span more than one vehicle group.
 */
export function findCrossVehicleClusters(db: PrismaClient): Promise<ImageCluster[]> {
  return db.imageCluster.findMany({
    where: { crossVehicle: true },
    orderBy: { vehicleCount: 'desc' },
  })
}
