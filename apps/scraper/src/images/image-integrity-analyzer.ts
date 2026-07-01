/**
 * image-integrity-analyzer — groups listing images into exact/near-duplicate
 * clusters and classifies placeholder and suspect images.
 *
 * Design:
 *   - Pure clustering: no I/O, no DB calls.  Callers (backfill/job) persist.
 *   - Two-pass algorithm:
 *       Pass 1 — exact clusters by SHA-256 hash.
 *       Pass 2 — near-duplicate clusters by dHash Hamming distance (greedy
 *                union-find over images not already in an exact cluster).
 *   - Cross-vehicle detection: a cluster is cross-vehicle when its members
 *     span more than one distinct non-null vehicleId (or more than one VIN
 *     when vehicleId is absent but VIN is available).
 *   - Placeholder classification: images whose cluster spans more than
 *     PLACEHOLDER_LISTING_THRESHOLD distinct listings are classified as
 *     probable stock/dealer imagery and are ineligible as verification evidence.
 *   - Source-gallery association: each ImageRecord carries a sourceId so
 *     whole-page fallback images can be distinguished from gallery images
 *     (callers are responsible for setting gallerySource correctly; this
 *     module only records what it is given).
 *   - Hero/evidence eligibility: a ListingImage is eligible as hero evidence
 *     when its kind is `vehicle_photo` and it is not in a placeholder/
 *     cross-vehicle cluster.  Policy for all-suspect galleries is documented
 *     in the heroEligibility export.
 *
 * No raw bytes or pixel data are referenced here — inputs are the hash strings
 * produced by image-hasher.ts.
 */

import { hammingDistance, PHASH_NEAR_DUPLICATE_THRESHOLD } from './image-hasher.js'
import { isSiteChromeUrl } from './image-normalizer.js'

/** A cross-vehicle reuse count above this threshold classifies an image as a placeholder. */
export const PLACEHOLDER_LISTING_THRESHOLD = 5

/** Maximum Hamming distance to consider two dHash values near-duplicates. */
export const NEAR_DUPLICATE_HAMMING_THRESHOLD = PHASH_NEAR_DUPLICATE_THRESHOLD

/**
 * Minimal per-image record supplied by the caller (loaded from DB or freshly scraped).
 *
 * The analyzer never performs I/O — callers are responsible for loading images
 * and persisting the output clusters.
 */
export interface AnalyzerImage {
  /** Stable DB id for this image record. */
  id: string
  listingId: string
  sourceId: string
  /** Non-null vehicleId when the listing is linked to a verified physical vehicle. */
  vehicleId: string | null
  /** VIN when available — used as fallback vehicle-group key when vehicleId is null. */
  vin: string | null
  normalizedUrl: string
  /** Hex SHA-256 of image bytes. Null if download failed or was skipped. */
  exactHash: string | null
  /** 16-char hex dHash. Null if download failed or was skipped. */
  pHash: string | null
  position: number
}

/** The kind assigned to an image after analysis. */
export type ImageKind = 'vehicle_photo' | 'placeholder' | 'site_chrome' | 'excluded'

/** Result produced for a single image after clustering + classification. */
export interface AnalyzedImage {
  id: string
  kind: ImageKind
  /** Cluster id, if the image was grouped into an exact or near-duplicate cluster. */
  clusterId: string | null
}

export interface ClusterRecord {
  /** Temporary cluster id (a hash or UUID assigned by the analyzer). */
  id: string
  clusterType: 'exact' | 'near'
  representativeHash: string
  listingCount: number
  sourceCount: number
  vehicleCount: number
  crossVehicle: boolean
  isPlaceholder: boolean
  reasonCode: string | null
  /** The image ids that belong to this cluster. */
  memberIds: string[]
}

export interface AnalysisResult {
  images: AnalyzedImage[]
  clusters: ClusterRecord[]
}

/**
 * Analyse a set of images and return their cluster assignments and kinds.
 *
 * Intended to be called once per batch (e.g. all images for a source, or all
 * images for a listing).  The caller is responsible for persisting
 * ClusterRecord rows and updating ListingImage rows.
 *
 * @param images  - A flat list of images to cluster.  May span multiple
 *                  listings, sources, and vehicles.
 */
export function analyzeImages(images: AnalyzerImage[]): AnalysisResult {
  const resultImages: Map<string, AnalyzedImage> = new Map()
  const clusters: ClusterRecord[] = []

  // Pre-classify site-chrome and images without hashes (download failures, etc.)
  for (const img of images) {
    if (isSiteChromeUrl(img.normalizedUrl)) {
      resultImages.set(img.id, { id: img.id, kind: 'site_chrome', clusterId: null })
    } else if (img.exactHash === null && img.pHash === null) {
      resultImages.set(img.id, { id: img.id, kind: 'excluded', clusterId: null })
    }
  }

  // Work only with images that have at least one hash and aren't site-chrome
  const hashable = images.filter((img) => !resultImages.has(img.id))

  // ── Pass 1: exact clusters (same SHA-256) ─────────────────────────────────

  const exactGroups = new Map<string, AnalyzerImage[]>()
  for (const img of hashable) {
    if (img.exactHash === null) continue
    const group = exactGroups.get(img.exactHash)
    if (group) group.push(img)
    else exactGroups.set(img.exactHash, [img])
  }

  // Images assigned to an exact cluster (skip them in pass 2)
  const assignedToExact = new Set<string>()

  for (const [hash, members] of exactGroups) {
    if (members.length < 2) {
      // Unique image — not a cluster.  Will be handled in pass 2 or left as vehicle_photo.
      continue
    }
    const cluster = buildCluster(`exact:${hash}`, 'exact', hash, members)
    clusters.push(cluster)
    for (const m of members) {
      assignedToExact.add(m.id)
      resultImages.set(m.id, {
        id: m.id,
        kind: cluster.isPlaceholder ? 'placeholder' : 'vehicle_photo',
        clusterId: cluster.id,
      })
    }
  }

  // ── Pass 2: near-duplicate clusters (dHash Hamming ≤ threshold) ──────────
  // Greedy algorithm: iterate unassigned images with a pHash; for each one,
  // check whether it falls within the threshold of an existing near cluster's
  // representative hash; if so, add it; otherwise start a new cluster.

  const unassigned = hashable.filter((img) => !assignedToExact.has(img.id) && img.pHash !== null)

  // Near clusters represented by their representative hash and member list.
  const nearClusters: { repHash: string; members: AnalyzerImage[] }[] = []

  for (const img of unassigned) {
    let matched = false
    for (const nc of nearClusters) {
      if (hammingDistance(img.pHash!, nc.repHash) <= NEAR_DUPLICATE_HAMMING_THRESHOLD) {
        nc.members.push(img)
        matched = true
        break
      }
    }
    if (!matched) {
      nearClusters.push({ repHash: img.pHash!, members: [img] })
    }
  }

  for (const nc of nearClusters) {
    if (nc.members.length < 2) {
      // Unique image — not a cluster.
      continue
    }
    const cluster = buildCluster(`near:${nc.repHash}`, 'near', nc.repHash, nc.members)
    clusters.push(cluster)
    for (const m of nc.members) {
      resultImages.set(m.id, {
        id: m.id,
        kind: cluster.isPlaceholder ? 'placeholder' : 'vehicle_photo',
        clusterId: cluster.id,
      })
    }
  }

  // ── Assign remaining images (not in any cluster) as vehicle_photo ─────────

  for (const img of hashable) {
    if (!resultImages.has(img.id)) {
      resultImages.set(img.id, { id: img.id, kind: 'vehicle_photo', clusterId: null })
    }
  }

  return {
    images: Array.from(resultImages.values()),
    clusters,
  }
}

/** Build a ClusterRecord from a group of member images, computing all counts. */
function buildCluster(
  id: string,
  clusterType: 'exact' | 'near',
  representativeHash: string,
  members: AnalyzerImage[],
): ClusterRecord {
  const listingIds = new Set<string>()
  const sourceIds = new Set<string>()
  const vehicleKeys = new Set<string>() // vehicleId or VIN where available

  for (const m of members) {
    listingIds.add(m.listingId)
    sourceIds.add(m.sourceId)
    if (m.vehicleId) {
      vehicleKeys.add(`v:${m.vehicleId}`)
    } else if (m.vin) {
      vehicleKeys.add(`vin:${m.vin}`)
    }
  }

  const crossVehicle = vehicleKeys.size > 1
  const isPlaceholder = listingIds.size > PLACEHOLDER_LISTING_THRESHOLD

  let reasonCode: string | null = null
  if (isPlaceholder && crossVehicle) {
    reasonCode = `reused across ${listingIds.size} listings and ${vehicleKeys.size} vehicle groups from ${sourceIds.size} sources`
  } else if (isPlaceholder) {
    reasonCode = `reused across ${listingIds.size} listings from ${sourceIds.size} sources`
  } else if (crossVehicle) {
    reasonCode = `spans ${vehicleKeys.size} vehicle groups — ineligible as vehicle-specific evidence`
  }

  return {
    id,
    clusterType,
    representativeHash,
    listingCount: listingIds.size,
    sourceCount: sourceIds.size,
    vehicleCount: vehicleKeys.size,
    crossVehicle,
    isPlaceholder,
    reasonCode,
    memberIds: members.map((m) => m.id),
  }
}

/**
 * Determine whether a listing's image set has any hero-eligible images.
 *
 * An image is hero-eligible when:
 *   - kind = 'vehicle_photo' (not placeholder, not site_chrome, not excluded)
 *   - it is not in a cross-vehicle cluster
 *
 * Policy for all-suspect galleries:
 *   When every image in a gallery is classified as placeholder, site_chrome,
 *   or excluded, the listing is NOT hidden — it remains in the active index.
 *   However no image should be promoted as the listing's hero.  The caller
 *   should fall back to a "no image available" placeholder in the UI.
 *   An `all_suspect_gallery` quality issue code should be added to the listing
 *   via qualityIssueCodes so operators can review and the listing is visually
 *   distinguished from image-confirmed vehicles.
 */
export function heroEligibleImages(
  analyzedImages: AnalyzedImage[],
  clusters: ClusterRecord[],
): AnalyzedImage[] {
  const crossVehicleClusterIds = new Set(
    clusters.filter((c) => c.crossVehicle).map((c) => c.id),
  )
  return analyzedImages.filter(
    (img) =>
      img.kind === 'vehicle_photo' &&
      (img.clusterId === null || !crossVehicleClusterIds.has(img.clusterId)),
  )
}

/**
 * Classify the vehicle-group reuse context of a cluster.
 *
 * - `same_vehicle`: all members belong to the same vehicleId / VIN group.
 *   Legitimate: the same physical vehicle listed at multiple sources.
 * - `cross_vehicle`: members span more than one vehicle group.
 *   Suspect: stock imagery, dealer placeholder, or scraping error.
 * - `no_vehicle_context`: no member has a vehicleId or VIN.
 *   Cannot determine reuse context without vehicle identity.
 */
export type ReuseContext = 'same_vehicle' | 'cross_vehicle' | 'no_vehicle_context'

export function classifyReuseContext(cluster: ClusterRecord): ReuseContext {
  if (cluster.vehicleCount === 0) return 'no_vehicle_context'
  if (cluster.crossVehicle) return 'cross_vehicle'
  return 'same_vehicle'
}
