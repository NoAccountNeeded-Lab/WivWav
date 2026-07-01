/**
 * Image integrity backfill (issue #503).
 *
 * Hashes all existing listing images, clusters exact/near-duplicates, detects
 * placeholders and cross-VIN reuse, and updates listing_image + image_cluster
 * rows.  Public hero selection is NOT changed until the operator reviews the
 * report and explicitly enables it.
 *
 * Usage:
 *   pnpm tsx apps/scraper/src/jobs/image-integrity-backfill.ts --report
 *   pnpm tsx apps/scraper/src/jobs/image-integrity-backfill.ts --apply
 *   pnpm tsx apps/scraper/src/jobs/image-integrity-backfill.ts --apply --source <sourceId>
 *   pnpm tsx apps/scraper/src/jobs/image-integrity-backfill.ts --apply --limit 500
 *
 * Always run --report first and review output before --apply.
 *
 * --report mode:
 *   Downloads and hashes images, builds clusters, and prints a summary WITHOUT
 *   writing any listing_image or image_cluster rows.  No DB side-effects other
 *   than read queries.
 *
 * --apply mode:
 *   Same as --report but also upserts listing_image and image_cluster rows.
 *   Idempotent — re-running on the same set of listings is safe.
 *
 * --source <sourceId>
 *   Scope the run to a single source for phased rollout.
 *
 * --limit N
 *   Process at most N listings (default: unlimited).
 *
 * Metrics reported:
 *   - Total listings audited, total image URLs processed
 *   - Exact duplicates (by hash cluster count and member count)
 *   - Perceptual near-duplicate clusters
 *   - Placeholders detected (cross-listing reuse above threshold)
 *   - Cross-VIN clusters (same image on different verified vehicles)
 *   - Failed downloads (timeout / bad content-type / oversized / HTTP error)
 *   - Images excluded as site-chrome
 *
 * Rollback procedure:
 *   listing_image and image_cluster rows are supplementary metadata — they do
 *   not alter the listing's images[] array or publicationStatus directly.
 *   To revert:
 *
 *   -- Remove all image integrity metadata added by this job.
 *   DELETE FROM "listing_image" WHERE "analysisVersion" = 1;
 *   DELETE FROM "image_cluster" WHERE "analysisVersion" = 1;
 *
 *   Then re-run --report with the corrected configuration.
 *
 * Post-release smoke checks:
 *   1. Confirm total image rows in listing_image matches --report totals.
 *   2. Spot-check 5-10 placeholder clusters — verify they are genuine stock
 *      photos, not legitimate same-vehicle multi-source records.
 *   3. Confirm cross-VIN clusters surface in the operator inspection endpoint.
 *   4. Verify no listing's publicationStatus was changed (it should not be —
 *      hero ineligibility is additive metadata, not a quarantine gate).
 *
 * Release sequencing:
 *   1. Deploy the schema migration (listing_image, image_cluster).
 *   2. Run --report, review output.
 *   3. Run --apply (optionally --source <id> for phased rollout).
 *   4. Build operator inspection UI (#503 follow-up) to surface clusters.
 *   5. Only then wire hero selection to hero-eligibility output.
 *
 * Privacy / licensing:
 *   This job downloads third-party images solely to compute hash fingerprints.
 *   Raw image bytes and pixel data are discarded immediately after hashing.
 *   No images are proxied, stored, or re-served.  Operators are responsible
 *   for ensuring their scraping activity complies with each source's ToS.
 *
 * @module
 */

import { getDb, upsertListingImage, upsertImageCluster } from '@wivwav/db'
import type { Listing } from '@wivwav/db'
import { hashImage, ImageHasherOptions } from '../images/image-hasher.js'
import { normalizeImageUrl, isSiteChromeUrl } from '../images/image-normalizer.js'
import {
  analyzeImages,
  type AnalyzerImage,
  type AnalysisResult,
} from '../images/image-integrity-analyzer.js'
import { jitteredSleep } from '../util/jitter-sleep.js'

const BATCH_SIZE = 100

/** Milliseconds to sleep between individual image downloads to avoid hammering origins. */
const INTER_IMAGE_DELAY_MS = 200

export interface ImageIntegrityBackfillReport {
  /** Total listings whose image arrays were inspected. */
  totalListingsAudited: number
  /** Total individual image URLs submitted for download. */
  totalImageUrls: number
  /** URLs skipped as site-chrome (no download attempted). */
  siteChrome: number
  /** Downloads that failed (timeout, bad content-type, oversized, HTTP error). */
  downloadFailures: number
  /** Images with a successful download (exactHash populated). */
  successfulDownloads: number
  /** Number of exact-duplicate clusters (≥2 members sharing a SHA-256 hash). */
  exactClusters: number
  /** Number of near-duplicate clusters (≥2 members within pHash Hamming threshold). */
  nearClusters: number
  /** Clusters classified as probable placeholders (reuse above threshold). */
  placeholderClusters: number
  /** Clusters that span more than one vehicle group. */
  crossVehicleClusters: number
  /** Download failure breakdown by reason. */
  failuresByKind: Record<string, number>
  /** When sourceId was given, the source it was scoped to. */
  scopedToSourceId?: string
}

async function runImageIntegrityBackfill(opts: {
  apply: boolean
  sourceId?: string
  limit?: number
  hasherOptions?: ImageHasherOptions
}): Promise<ImageIntegrityBackfillReport> {
  const db = getDb()

  const report: ImageIntegrityBackfillReport = {
    totalListingsAudited: 0,
    totalImageUrls: 0,
    siteChrome: 0,
    downloadFailures: 0,
    successfulDownloads: 0,
    exactClusters: 0,
    nearClusters: 0,
    placeholderClusters: 0,
    crossVehicleClusters: 0,
    failuresByKind: {},
    ...(opts.sourceId !== undefined ? { scopedToSourceId: opts.sourceId } : {}),
  }

  // ── Load listings with non-empty image arrays ──────────────────────────────

  const allListings: Pick<Listing, 'id' | 'sourceId' | 'vehicleId' | 'vin' | 'images'>[] = []
  let cursor: string | undefined

  outer: for (;;) {
    const rows = await db.listing.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        status: 'active',
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      },
      select: {
        id: true,
        sourceId: true,
        vehicleId: true,
        vin: true,
        images: true,
      },
      orderBy: { id: 'asc' },
    })
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.images.length > 0) allListings.push(row)
      if (opts.limit !== undefined && allListings.length >= opts.limit) break outer
    }
    cursor = rows[rows.length - 1]!.id
    if (rows.length < BATCH_SIZE) break
  }

  report.totalListingsAudited = allListings.length

  // ── Hash images listing by listing ────────────────────────────────────────

  const allAnalyzerImages: AnalyzerImage[] = []

  for (const listing of allListings) {
    for (let pos = 0; pos < listing.images.length; pos++) {
      const originalUrl = listing.images[pos]!
      report.totalImageUrls++

      const normalizedUrl = normalizeImageUrl(originalUrl)

      if (isSiteChromeUrl(normalizedUrl)) {
        report.siteChrome++
        allAnalyzerImages.push({
          id: imageRecordId(listing.id, originalUrl),
          listingId: listing.id,
          sourceId: listing.sourceId,
          vehicleId: listing.vehicleId,
          vin: listing.vin,
          normalizedUrl,
          exactHash: null,
          pHash: null,
          position: pos,
        })
        continue
      }

      // Rate-limit: small sleep between downloads.
      if (report.totalImageUrls > 1) {
        await jitteredSleep(INTER_IMAGE_DELAY_MS, 0.5)
      }

      const outcome = await hashImage(normalizedUrl, opts.hasherOptions)

      if (!outcome.ok) {
        report.downloadFailures++
        report.failuresByKind[outcome.kind] = (report.failuresByKind[outcome.kind] ?? 0) + 1
        allAnalyzerImages.push({
          id: imageRecordId(listing.id, originalUrl),
          listingId: listing.id,
          sourceId: listing.sourceId,
          vehicleId: listing.vehicleId,
          vin: listing.vin,
          normalizedUrl,
          exactHash: null,
          pHash: null,
          position: pos,
        })
        continue
      }

      report.successfulDownloads++
      allAnalyzerImages.push({
        id: imageRecordId(listing.id, originalUrl),
        listingId: listing.id,
        sourceId: listing.sourceId,
        vehicleId: listing.vehicleId,
        vin: listing.vin,
        normalizedUrl,
        exactHash: outcome.exactHash,
        pHash: outcome.pHash,
        position: pos,
      })
    }
  }

  // ── Cluster analysis ──────────────────────────────────────────────────────

  const analysisResult: AnalysisResult = analyzeImages(allAnalyzerImages)

  report.exactClusters = analysisResult.clusters.filter((c) => c.clusterType === 'exact').length
  report.nearClusters = analysisResult.clusters.filter((c) => c.clusterType === 'near').length
  report.placeholderClusters = analysisResult.clusters.filter((c) => c.isPlaceholder).length
  report.crossVehicleClusters = analysisResult.clusters.filter((c) => c.crossVehicle).length

  // ── Persist (--apply only) ────────────────────────────────────────────────

  if (opts.apply) {
    // Build cluster id → DB id map (we need the DB id to set clusterId on images)
    const clusterDbIds = new Map<string, string>()

    for (const cluster of analysisResult.clusters) {
      const dbCluster = await upsertImageCluster(db, {
        clusterType: cluster.clusterType,
        representativeHash: cluster.representativeHash,
        listingCount: cluster.listingCount,
        sourceCount: cluster.sourceCount,
        vehicleCount: cluster.vehicleCount,
        crossVehicle: cluster.crossVehicle,
        isPlaceholder: cluster.isPlaceholder,
        reasonCode: cluster.reasonCode,
        analysisVersion: 1,
      })
      clusterDbIds.set(cluster.id, dbCluster.id)
    }

    // Build a map from analyzer image id → analyzed result
    const analyzedById = new Map(analysisResult.images.map((img) => [img.id, img]))

    for (const analyzerImg of allAnalyzerImages) {
      const analyzed = analyzedById.get(analyzerImg.id)
      const originalUrl = originalUrlFromId(analyzerImg.id)
      const clusterAnalyzerId = analyzed?.clusterId ?? null
      const dbClusterId = clusterAnalyzerId !== null ? (clusterDbIds.get(clusterAnalyzerId) ?? null) : null

      // Map analyzer kind to Prisma ImageKind
      const prismaKind = kindToPrisma(analyzed?.kind ?? 'vehicle_photo')

      await upsertListingImage(db, {
        listingId: analyzerImg.listingId,
        originalUrl,
        normalizedUrl: analyzerImg.normalizedUrl,
        position: analyzerImg.position,
        kind: prismaKind,
        exactHash: analyzerImg.exactHash,
        pHash: analyzerImg.pHash,
        clusterId: dbClusterId,
        analysisVersion: 1,
      })
    }
  }

  await db.$disconnect()
  return report
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stable in-memory id for (listingId, originalUrl).
 * We use a separator that cannot appear in either part for readability.
 */
function imageRecordId(listingId: string, originalUrl: string): string {
  return `${listingId}:::${originalUrl}`
}

function originalUrlFromId(id: string): string {
  const sep = id.indexOf(':::')
  return sep >= 0 ? id.slice(sep + 3) : id
}

function kindToPrisma(
  kind: string,
): 'vehicle_photo' | 'placeholder' | 'site_chrome' | 'excluded' {
  if (kind === 'placeholder' || kind === 'site_chrome' || kind === 'excluded') {
    return kind as 'placeholder' | 'site_chrome' | 'excluded'
  }
  return 'vehicle_photo'
}

// ── Report printing ───────────────────────────────────────────────────────────

function printReport(report: ImageIntegrityBackfillReport, applied: boolean): void {
  const mode = applied ? 'APPLIED' : 'REPORT ONLY'
  const scope = report.scopedToSourceId ? ` [source: ${report.scopedToSourceId}]` : ''
  console.log(`\n=== Image Integrity Backfill [${mode}]${scope} ===\n`)

  console.log(`Active listings audited:   ${report.totalListingsAudited}`)
  console.log(`Total image URLs:          ${report.totalImageUrls}`)
  console.log(`  Site-chrome (skipped):   ${report.siteChrome}`)
  console.log(`  Successful downloads:    ${report.successfulDownloads}`)
  console.log(`  Download failures:       ${report.downloadFailures}`)

  if (report.downloadFailures > 0) {
    console.log('\n── Download failure breakdown ──')
    for (const [kind, count] of Object.entries(report.failuresByKind)) {
      console.log(`  ${kind}: ${count}`)
    }
  }

  console.log('\n── Clustering results ──')
  console.log(`  Exact-duplicate clusters:     ${report.exactClusters}`)
  console.log(`  Near-duplicate clusters:      ${report.nearClusters}`)
  console.log(`  Placeholder clusters:         ${report.placeholderClusters}`)
  console.log(`  Cross-VIN/vehicle clusters:   ${report.crossVehicleClusters}`)

  if (!applied) {
    console.log('\nThis was a dry run. No listing_image or image_cluster rows were written.')
    console.log('Run with --apply to persist results (optionally --source <sourceId>).')
  } else {
    console.log('\nResults persisted to listing_image and image_cluster tables.')
  }

  console.log('\n=== Done ===\n')
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  apply: boolean
  sourceId?: string
  limit?: number
} {
  const applyMode = argv.includes('--apply')
  if (!applyMode && !argv.includes('--report')) {
    console.error('Usage: image-integrity-backfill.ts --report | --apply [--source <sourceId>] [--limit N]')
    process.exit(1)
  }
  const sourceIdx = argv.indexOf('--source')
  const sourceId = sourceIdx >= 0 ? argv[sourceIdx + 1] : undefined
  const limitIdx = argv.indexOf('--limit')
  const limitRaw = limitIdx >= 0 ? argv[limitIdx + 1] : undefined
  const limit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined

  const result: { apply: boolean; sourceId?: string; limit?: number } = { apply: applyMode }
  if (sourceId !== undefined) result.sourceId = sourceId
  if (limit !== undefined && !isNaN(limit)) result.limit = limit
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2))
  runImageIntegrityBackfill(options)
    .then((report) => {
      printReport(report, options.apply)
    })
    .catch((err: unknown) => {
      console.error('Image integrity backfill failed:', err)
      process.exit(1)
    })
}

export { runImageIntegrityBackfill }
