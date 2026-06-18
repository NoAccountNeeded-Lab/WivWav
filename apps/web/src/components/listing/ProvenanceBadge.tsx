import { ExternalLink } from 'lucide-react'
import type { ListingProvenance } from '@/app/listings/[id]/types'
import {
  hasFullProvenance,
  hasProvenanceLink,
  resolveProvenanceHref,
} from './provenanceUtils'
import styles from './ProvenanceBadge.module.css'

interface ProvenanceBadgeProps {
  provenance: ListingProvenance | null | undefined
}

/**
 * Shows source attribution for a listing: source name + link and base URL.
 * Falls back gracefully when provenance fields are missing.
 */
export function ProvenanceBadge({ provenance }: ProvenanceBadgeProps) {
  if (!hasFullProvenance(provenance)) {
    return (
      <p className={styles.badge}>
        <span className={styles.label}>Source:</span>
        <span className={styles.fallback}>Unknown source</span>
      </p>
    )
  }

  const linkHref = resolveProvenanceHref(provenance)
  const hasLink = hasProvenanceLink(provenance)
  const { sourceName, sourceBaseUrl } = provenance

  return (
    <p className={styles.badge}>
      <span className={styles.label}>Source:</span>
      {hasLink && linkHref ? (
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.sourceLink}
        >
          {sourceName}
          <ExternalLink size={10} aria-hidden className={styles.externalIcon} />
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ) : (
        <span className={styles.sourceName}>{sourceName}</span>
      )}
      {sourceBaseUrl && (
        <span className={styles.sourceBase} aria-label={`from ${sourceBaseUrl}`}>
          {sourceBaseUrl}
        </span>
      )}
    </p>
  )
}
