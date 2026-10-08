/**
 * image-phash-query — SQL-backed near-duplicate image lookup (#1115).
 *
 * The analyzer (`image-integrity-analyzer.ts`) clusters purely in memory.
 * This module answers the same "within Hamming threshold" question against
 * stored `listing_image` rows with a single SQL query per lookup
 * (`bit_count(("listing_image"."pHashInt" # $1)::bit(64))`), so callers never
 * load the image set into application memory.
 *
 * Threshold single source of truth: `PHASH_NEAR_DUPLICATE_THRESHOLD` from
 * `image-hasher.ts` (re-exported by the analyzer as
 * `NEAR_DUPLICATE_HAMMING_THRESHOLD`). Both entry points below default to it;
 * pass an explicit `threshold` only to experiment, never to fork the policy.
 */

import {
  findImagesWithinHammingDistance,
  type NearDuplicateImage,
  type NearDuplicateQueryOptions as DbNearDuplicateQueryOptions,
  type PrismaClient,
} from '@wivwav/db'
import { PHASH_NEAR_DUPLICATE_THRESHOLD } from './image-hasher.js'
import type { NearDuplicateCandidate } from './image-integrity-analyzer.js'

export type { NearDuplicateImage }

export interface NearDuplicateQueryOptions extends DbNearDuplicateQueryOptions {
  /** Hamming-distance threshold. Defaults to PHASH_NEAR_DUPLICATE_THRESHOLD. */
  threshold?: number
}

/**
 * Return all stored images within the threshold of `pHashHex`.
 *
 * Exactly one SQL query; the full image set is never loaded into memory.
 * Throws on a malformed query hash before touching the database.
 */
export function findNearDuplicateImages(
  db: PrismaClient,
  pHashHex: string,
  options: NearDuplicateQueryOptions = {},
): Promise<NearDuplicateImage[]> {
  return findImagesWithinHammingDistance(
    db,
    pHashHex,
    options.threshold ?? PHASH_NEAR_DUPLICATE_THRESHOLD,
    {
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.ids !== undefined ? { ids: options.ids } : {}),
    },
  )
}

/**
 * Batch near-duplicate clustering over stored rows (#1115 parity path).
 *
 * Same greedy algorithm as analyzer pass 2 (`greedyNearDuplicateClusters`),
 * but each cluster representative triggers one SQL neighbor lookup instead of
 * an in-memory scan — one query per formed cluster, never a full-table load.
 * Produces the same cluster assignments as the in-memory implementation for
 * the same candidate order (see the parity test).
 *
 * Lookups are restricted to the candidate ids, so rows outside the candidate
 * set (other listings, images already claimed by exact-hash clusters) never
 * join a cluster — matching the in-memory pass, which only sees its inputs.
 *
 * @param candidates - Images with a hex pHash, in clustering order. Each
 *   cluster lists its seed first, then the remaining members by distance.
 */
export async function clusterStoredNearDuplicates(
  db: PrismaClient,
  candidates: NearDuplicateCandidate[],
  options: Pick<NearDuplicateQueryOptions, 'threshold'> = {},
): Promise<NearDuplicateCandidate[][]> {
  const threshold = options.threshold ?? PHASH_NEAR_DUPLICATE_THRESHOLD
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const ids = candidates.map((c) => c.id)
  const assigned = new Set<string>()
  const clusters: NearDuplicateCandidate[][] = []

  for (const seed of candidates) {
    if (assigned.has(seed.id)) continue
    const neighbors = await findImagesWithinHammingDistance(db, seed.pHash, threshold, { ids })
    const members: NearDuplicateCandidate[] = [seed]
    assigned.add(seed.id)
    for (const n of neighbors) {
      if (assigned.has(n.id)) continue
      const known = byId.get(n.id)
      if (known === undefined) continue
      assigned.add(n.id)
      members.push(known)
    }
    clusters.push(members)
  }

  return clusters
}
