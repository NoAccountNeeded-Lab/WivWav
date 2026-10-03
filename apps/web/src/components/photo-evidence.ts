import type { Translate } from '@/lib/intl'

export interface PhotoSemanticClaim {
  field: string
  claimedValue: string
  confidence: number
}

export interface PhotoSemanticEvidence {
  imageId: string
  originalUrl: string
  normalizedUrl: string
  position: number
  claims: PhotoSemanticClaim[]
}

export interface PhotoEvidenceResult {
  /** Parallel to the `images` input by index; `null` means no AI alt text for that image. */
  imageAlts: (string | null)[]
  /** Parallel to the `images` input by index; `null` means the image has no filter category. */
  imageCategories: (string[] | null)[]
  /** Category id → display label, for filter chip text. */
  categoryLabels: Record<string, string>
}

// #799 only allowlists rampType claims server-side today; this map is the
// single place that grows as more claim types clear the calibration gate.
const CATEGORY_BY_FIELD: Record<string, { id: string; labelKey: string }> = {
  rampType: { id: 'ramp', labelKey: 'categoryRamp' },
}

const ALT_TEXT_KEY_BY_CLAIM: Record<string, string> = {
  'rampType:in_floor': 'altInFloor',
  'rampType:fold_out': 'altFoldOut',
  'rampType:fold_in': 'altFoldIn',
}

/**
 * Maps #799's per-image semantic evidence onto a listing's flat `images`
 * URL list so `PhotoGallery` can render AI-derived alt text and category
 * filter chips. Matches evidence to images by exact `originalUrl` equality —
 * `ListingImage.originalUrl` is the same raw string the scraper stores in
 * `Listing.images` (see apps/worker/src/handlers/detail-extract.ts).
 *
 * Returns all-null arrays and an empty label map when there is no evidence,
 * so callers can pass the result straight through to `PhotoGallery` without
 * a conditional and get the component's unmodified legacy behavior.
 */
/** `t` is the `PhotoEvidence` translator. */
export function buildPhotoEvidence(
  images: string[],
  semanticEvidence: PhotoSemanticEvidence[] | undefined,
  t: Translate,
): PhotoEvidenceResult {
  const imageAlts: (string | null)[] = images.map(() => null)
  const imageCategories: (string[] | null)[] = images.map(() => null)
  const categoryLabels: Record<string, string> = {}

  if (!semanticEvidence || semanticEvidence.length === 0) {
    return { imageAlts, imageCategories, categoryLabels }
  }

  const evidenceByUrl = new Map<string, PhotoSemanticEvidence>()
  for (const evidence of semanticEvidence) {
    evidenceByUrl.set(evidence.originalUrl, evidence)
  }

  images.forEach((src, index) => {
    const evidence = evidenceByUrl.get(src)
    if (!evidence) return

    const categoryIds: string[] = []
    const altPhrases: string[] = []

    for (const claim of evidence.claims) {
      const category = CATEGORY_BY_FIELD[claim.field]
      if (!category) continue
      if (!categoryIds.includes(category.id)) categoryIds.push(category.id)
      categoryLabels[category.id] = t(category.labelKey)

      const altKey = ALT_TEXT_KEY_BY_CLAIM[`${claim.field}:${claim.claimedValue}`]
      const altPhrase = altKey ? t(altKey) : undefined
      if (altPhrase && !altPhrases.includes(altPhrase)) altPhrases.push(altPhrase)
    }

    if (categoryIds.length > 0) imageCategories[index] = categoryIds
    if (altPhrases.length > 0) imageAlts[index] = altPhrases.join(', ')
  })

  return { imageAlts, imageCategories, categoryLabels }
}
