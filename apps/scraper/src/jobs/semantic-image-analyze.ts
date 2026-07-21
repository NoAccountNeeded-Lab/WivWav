/**
 * #798 — per-image worker for #796/#797's semantic image analysis.
 *
 * Each job processes exactly one `ListingImage`. Eligibility is re-checked
 * at process time (not just at enqueue time in the #798 backfill script)
 * because a cluster's placeholder/cross-vehicle classification, or the
 * image's analyzed version, may have changed between enqueue and run —
 * this keeps re-enqueue idempotent and safe to run broadly.
 *
 * Download failures throw so BullMQ's configured attempts/backoff can
 * retry; provider errors and malformed responses are handled inside
 * `analyzeListingImage` itself and never throw (recorded as an `error`
 * row instead).
 */

import { getDb } from '@wivwav/db'
import type { JobContext } from '@wivwav/queue'
import { report } from './job-progress.js'
import { hashImage } from '../images/image-hasher.js'
import { analyzeListingImage, CURRENT_SEMANTIC_ANALYSIS_VERSION } from '../images/semantic-image-analysis.js'
import { NoopImageAnalysisProvider } from '../images/image-analysis-provider.js'
import type { ImageAnalysisProvider } from '../images/image-analysis-provider.js'

export interface SemanticImageAnalyzeJobData {
  listingImageId: string
}

const defaultProvider = new NoopImageAnalysisProvider()

export async function runSemanticImageAnalyzeJob(
  data: SemanticImageAnalyzeJobData,
  context?: JobContext,
  provider: ImageAnalysisProvider = defaultProvider,
): Promise<void> {
  const db = getDb()

  const image = await db.listingImage.findUnique({
    where: { id: data.listingImageId },
    include: { cluster: true },
  })

  if (!image) {
    await report(context, `[semantic-image-analyze] ${data.listingImageId}: image no longer exists, skipping`)
    return
  }

  const ineligible =
    image.kind !== 'vehicle_photo' || image.cluster?.isPlaceholder === true || image.cluster?.crossVehicle === true
  if (ineligible) {
    await report(context, `[semantic-image-analyze] ${image.id}: no longer eligible, skipping`)
    return
  }

  if (image.semanticAnalysisVersion !== null && image.semanticAnalysisVersion >= CURRENT_SEMANTIC_ANALYSIS_VERSION) {
    await report(context, `[semantic-image-analyze] ${image.id}: already current, skipping`)
    return
  }

  const outcome = await hashImage(image.normalizedUrl, { keepBytes: true })
  if (!outcome.ok) {
    await report(context, `[semantic-image-analyze] ${image.id}: download failed (${outcome.kind})`)
    throw new Error(`semantic-image-analyze: download failed for ${image.id}: ${outcome.kind}`)
  }

  const row = await analyzeListingImage(db, provider, {
    listingImageId: image.id,
    contentHash: outcome.exactHash,
    imageBytes: outcome.bytes!,
    contentType: outcome.contentType,
  })

  await report(context, `[semantic-image-analyze] ${image.id}: ${row.status}`)
}
