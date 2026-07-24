'use client'

import Link from 'next/link'
import type { SourceRow } from '../../overview-helpers'
import styles from './docked-terminal.module.css'

interface SourcePanelContentProps {
  sourceId: string
  sources: SourceRow[] | null
}

/** Source panel content, opened via the `problems` panel's entity
 *  relationship link (#913). Reads from the same already-loaded `sources`
 *  resource `problems` and `readiness` share — no separate fetch. */
export function SourcePanelContent({ sourceId, sources }: SourcePanelContentProps) {
  const source = sources?.find(s => s.id === sourceId)

  if (!sources) {
    return (
      <div className={styles.panelBody}>
        <p className={styles.muted}>Loading source…</p>
      </div>
    )
  }

  if (!source) {
    return (
      <div className={styles.panelBody}>
        <p className={styles.muted}>Source &ldquo;{sourceId}&rdquo; was not found in the current source list.</p>
        <Link href="/ops/sources" className={styles.inlineLinkButton}>Open Source health</Link>
      </div>
    )
  }

  return (
    <div className={styles.panelBody}>
      <dl className={styles.detailList}>
        <div><dt>Status</dt><dd>{source.status}</dd></div>
        <div><dt>Listings</dt><dd>{source.listingCount.toLocaleString()}</dd></div>
        <div><dt>Last scraped</dt><dd>{source.lastScrapedAt ?? 'never'}</dd></div>
        {source.errorMessage && <div><dt>Error</dt><dd className={styles.errorText}>{source.errorMessage}</dd></div>}
      </dl>
      <Link href="/ops/sources" className={styles.inlineLinkButton}>Open full Source health page</Link>
    </div>
  )
}
