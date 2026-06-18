import type { ListingProvenance } from '@/app/listings/[id]/types'

/** Returns true for URLs that are safe to use as an href. Rejects non-http(s) schemes. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Resolves the href to link to the original listing. Returns null for unsafe or missing URLs. */
export function resolveProvenanceHref(
  provenance: ListingProvenance | null | undefined,
): string | null {
  if (!provenance) return null
  const href = provenance.buyerUrl ?? provenance.sourceUrl
  if (!href || !isSafeUrl(href)) return null
  return href
}

/** Returns true if provenance data is sufficiently complete to show attribution. */
export function hasFullProvenance(
  provenance: ListingProvenance | null | undefined,
): provenance is ListingProvenance {
  return (
    provenance != null &&
    typeof provenance.sourceName === 'string' &&
    provenance.sourceName.trim().length > 0
  )
}

/** Returns true if the provenance has a linkable, safe-scheme URL. */
export function hasProvenanceLink(
  provenance: ListingProvenance | null | undefined,
): boolean {
  return resolveProvenanceHref(provenance) !== null
}

