/** Candidate filtering and photo selection for the local image-analysis runner (#1112). */

import type { EligibleSemanticAnalysisImage } from '../images/semantic-analysis-eligibility.js'

export interface ListingStageInfo {
  sourceId: string
  conversionType: string
  rampType: string
  detailScrapedAt: Date | null
}

export interface CandidateFilterResult {
  images: EligibleSemanticAnalysisImage[]
  /** Listings skipped because their source's detail stage has not run for them. */
  skippedUnfinished: number
  /** Listings skipped because conversion type and ramp type are both known. */
  skippedResolved: number
}

/**
 * Photos come last: analysis is meant to fill what the other stages left
 * unknown, so it skips listings that are still waiting on a stage that
 * would answer for free (the detail crawl) and listings already resolved.
 * A source "has a detail stage" when any of its listings has been through it.
 */
export function filterPhotoCandidates(
  images: EligibleSemanticAnalysisImage[],
  listings: Map<string, ListingStageInfo>,
  options: { onlyGaps: boolean; requireFinishedStages: boolean },
): CandidateFilterResult {
  const sourcesWithDetailStage = new Set<string>()
  for (const listing of listings.values()) if (listing.detailScrapedAt) sourcesWithDetailStage.add(listing.sourceId)

  const skippedUnfinishedIds = new Set<string>()
  const skippedResolvedIds = new Set<string>()
  const kept = images.filter((image) => {
    const listing = listings.get(image.listingId)
    if (!listing) return true
    if (options.requireFinishedStages && sourcesWithDetailStage.has(listing.sourceId) && !listing.detailScrapedAt) {
      skippedUnfinishedIds.add(image.listingId)
      return false
    }
    if (options.onlyGaps && listing.conversionType !== 'unknown' && listing.rampType !== 'unknown') {
      skippedResolvedIds.add(image.listingId)
      return false
    }
    return true
  })
  return { images: kept, skippedUnfinished: skippedUnfinishedIds.size, skippedResolved: skippedResolvedIds.size }
}

/** Takes the first `perListing` photos of each listing in gallery order, then applies the overall limit. */
export function selectPhotos(
  images: EligibleSemanticAnalysisImage[],
  perListing: number | undefined,
  limit: number | undefined,
): EligibleSemanticAnalysisImage[] {
  const byListing = new Map<string, EligibleSemanticAnalysisImage[]>()
  for (const image of images) {
    const group = byListing.get(image.listingId) ?? []
    group.push(image)
    byListing.set(image.listingId, group)
  }
  const selected: EligibleSemanticAnalysisImage[] = []
  for (const group of byListing.values()) {
    group.sort((a, b) => a.position - b.position)
    selected.push(...(perListing === undefined ? group : group.slice(0, perListing)))
  }
  return limit === undefined ? selected : selected.slice(0, limit)
}
