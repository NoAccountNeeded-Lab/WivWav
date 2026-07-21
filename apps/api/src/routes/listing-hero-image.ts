import type { ListingImageWithSemanticAnalyses } from '../repositories/index.js'

interface ScoredHeroImage {
  image: ListingImageWithSemanticAnalyses
  score: number
}

function exteriorConfidence(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const label = value as Record<string, unknown>
  const confidence = label['confidence']
  if (label['label'] !== 'exterior'
    || typeof confidence !== 'number'
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1) {
    return null
  }
  return confidence
}

/**
 * The semantic-analysis contract stores per-label confidence rather than a
 * separate heroScore column. The confidence of the controlled `exterior`
 * label is therefore the calibrated hero-candidacy score for #801.
 */
function scoreHeroImage(
  image: ListingImageWithSemanticAnalyses,
  confidenceThreshold: number,
): number | null {
  if (image.kind !== 'vehicle_photo'
    || image.exactHash === null
    || image.semanticAnalysisVersion === null
    || image.cluster?.crossVehicle === true
    || image.cluster?.isPlaceholder === true) {
    return null
  }

  let score: number | null = null
  for (const analysis of image.semanticAnalyses) {
    if (analysis.status !== 'success'
      || analysis.contentHash !== image.exactHash
      || analysis.semanticAnalysisVersion !== image.semanticAnalysisVersion
      || !Array.isArray(analysis.labels)) {
      continue
    }

    for (const label of analysis.labels) {
      const confidence = exteriorConfidence(label)
      if (confidence === null || confidence < confidenceThreshold) continue
      score = score === null ? confidence : Math.max(score, confidence)
    }
  }
  return score
}

function isBetterHero(candidate: ScoredHeroImage, current: ScoredHeroImage): boolean {
  if (candidate.score !== current.score) return candidate.score > current.score
  if (candidate.image.position !== current.image.position) {
    return candidate.image.position < current.image.position
  }
  return candidate.image.id.localeCompare(current.image.id) < 0
}

export function promoteHeroImage(
  images: string[],
  candidates: ListingImageWithSemanticAnalyses[] | undefined,
  confidenceThreshold: number,
): string[] {
  let selected: ScoredHeroImage | null = null

  for (const image of candidates ?? []) {
    // Ignore retained analysis rows for URLs no longer present in the current
    // scraped gallery. The fallback contract applies to this exact array.
    if (!images.includes(image.originalUrl)) continue
    const score = scoreHeroImage(image, confidenceThreshold)
    if (score === null) continue
    const candidate = { image, score }
    if (selected === null || isBetterHero(candidate, selected)) selected = candidate
  }

  if (selected === null || images[0] === selected.image.originalUrl) return images
  return [selected.image.originalUrl, ...images.filter((url) => url !== selected.image.originalUrl)]
}
