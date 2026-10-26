/** The persisted markers needed to decide whether a listing is ready to publish. */
export interface ListingReadinessInput {
  detailScrapedAt: Date | null
  detailStaleAt: Date | null
  qualityCheckedAt: Date | null
  publicationStatus: 'pending' | 'eligible' | 'quarantined'
  images: readonly string[]
  vin: string | null
  vehicleModelId: string | null
  conversionType: 'rear_entry' | 'side_entry' | 'unknown'
}

export type ReadinessBlocker =
  | 'detail_not_crawled'
  | 'detail_stale'
  | 'not_validated_after_detail'
  | 'no_images'
  | 'vin_not_decoded'
  | 'conversion_type_unresolved'

export type ReadinessWarning = 'no_vin' | 'no_city' | 'conversion_type_unknown'

export interface ListingReadiness {
  ready: boolean
  blockers: ReadinessBlocker[]
  warnings: ReadinessWarning[]
}

/**
 * Shared, side-effect-free readiness policy. This deliberately does not
 * include optional stages (geocoding, dealer enrichment, image semantics,
 * NHTSA data, or vehicle grouping).
 */
export function computeReadiness(
  listing: ListingReadinessInput & { city?: string | null },
): ListingReadiness {
  const blockers: ReadinessBlocker[] = []
  const warnings: ReadinessWarning[] = []
  const detailCurrent = listing.detailScrapedAt !== null && listing.detailStaleAt === null

  if (listing.detailScrapedAt === null) blockers.push('detail_not_crawled')
  else if (listing.detailStaleAt !== null) blockers.push('detail_stale')

  if (
    listing.detailScrapedAt === null ||
    listing.qualityCheckedAt === null ||
    listing.qualityCheckedAt < listing.detailScrapedAt ||
    listing.publicationStatus !== 'eligible'
  ) {
    blockers.push('not_validated_after_detail')
  }

  if (listing.images.length === 0) blockers.push('no_images')

  if (listing.vin === null || listing.vin.trim() === '') warnings.push('no_vin')
  else if (listing.vehicleModelId === null) blockers.push('vin_not_decoded')

  if (listing.conversionType === 'unknown') {
    warnings.push('conversion_type_unknown')
    if (!detailCurrent) blockers.push('conversion_type_unresolved')
  }

  if (listing.city == null || listing.city.trim() === '') warnings.push('no_city')

  return { ready: blockers.length === 0, blockers, warnings }
}
