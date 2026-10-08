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
import { pHashHexToInt } from './phash-int.js'

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
 *
 * `pHashInt` is always derived from `pHash` (dual-write, #1115) — there is
 * no separate input for it, so the two columns cannot disagree. Null `pHash`
 * stores null `pHashInt`. Throws on a malformed `pHash` hex string rather
 * than persisting a pair that disagrees.
 */
export async function upsertListingImage(
  db: PrismaClient,
  input: ListingImageInput,
): Promise<ListingImage> {
  const pHash = input.pHash ?? null
  const data = {
    normalizedUrl: input.normalizedUrl,
    position: input.position,
    kind: input.kind ?? ImageKind.vehicle_photo,
    widthPx: input.widthPx ?? null,
    heightPx: input.heightPx ?? null,
    exactHash: input.exactHash ?? null,
    pHash,
    pHashInt: pHash === null ? null : pHashHexToInt(pHash),
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
 * One row returned by {@link findImagesWithinHammingDistance}.
 */
export interface NearDuplicateImage {
  id: string
  listingId: string
  pHash: string | null
  pHashInt: bigint | null
  /** Hamming distance from the query hash (0 = identical bits). */
  hammingDistance: number
}

export interface NearDuplicateQueryOptions {
  /** Maximum rows to return, nearest first. Defaults to unlimited. */
  limit?: number
  /**
   * Restrict matches to these image ids (e.g. one listing's analyzer
   * candidates). Omit to search the whole table; an empty array matches nothing.
   */
  ids?: string[]
}

/**
 * Return all images whose stored pHash is within `threshold` bits of
 * `pHashHex` — a single SQL query, without loading the image set into
 * application memory (#1115).
 *
 * Predicate: `bit_count(("listing_image"."pHashInt" # $hash)::bit(64))`.
 * Postgres `bigint` is signed while a dHash is unsigned; both sides use the
 * same two's-complement reinterpretation (`pHashHexToInt`), so XOR/popcount
 * over the bit patterns is exact. Rows with null `pHashInt` (never hashed,
 * or a legacy malformed hex the backfill skipped) never match.
 *
 * There is no index that can serve this predicate (a btree on `pHashInt`
 * cannot evaluate XOR/popcount), so the query is a sequential scan of rows
 * with a non-null `pHashInt`; pass `ids` to bound it. Chunk-bucketed
 * candidate lookup is the scalable follow-up.
 *
 * `threshold` is a required positional so the single source of truth stays
 * with the caller (`PHASH_NEAR_DUPLICATE_THRESHOLD` via
 * `findNearDuplicateImages` in apps/api). Results are ordered by ascending
 * distance, then id for a stable tiebreak — so the query hash's own row is
 * not guaranteed to come first among identical hashes.
 */
export async function findImagesWithinHammingDistance(
  db: PrismaClient,
  pHashHex: string,
  threshold: number,
  options: NearDuplicateQueryOptions = {},
): Promise<NearDuplicateImage[]> {
  const hashInt = pHashHexToInt(pHashHex)
  // `LIMIT NULL` is equivalent to no limit in Postgres, which keeps this a
  // single query shape regardless of whether the caller bounds the result.
  const limit: number | null = options.limit ?? null
  const ids: string[] | null = options.ids ?? null
  return db.$queryRaw<NearDuplicateImage[]>`
    SELECT
      "listing_image"."id",
      "listing_image"."listingId",
      "listing_image"."pHash",
      "listing_image"."pHashInt",
      bit_count(("listing_image"."pHashInt" # ${hashInt})::bit(64))::integer AS "hammingDistance"
    FROM "listing_image"
    WHERE "listing_image"."pHashInt" IS NOT NULL
      AND (${ids}::text[] IS NULL OR "listing_image"."id" = ANY(${ids}::text[]))
      AND bit_count(("listing_image"."pHashInt" # ${hashInt})::bit(64)) <= ${threshold}
    ORDER BY "hammingDistance" ASC, "listing_image"."id" ASC
    LIMIT ${limit}`
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
