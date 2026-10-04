'use client'

import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import { useHelm } from '../helm-context'
import { Notice } from '../primitives'
import { SourceEvidenceGroups } from './EvidenceGroups'
import { Facts, InspectorSection } from './InspectorSections'
import { SourceActions } from './SourceActions'
import { useSelectedProblem } from './ProblemView'
import type { SourceRow } from '../../ops/overview-helpers'
import styles from './helm-inspector.module.css'

export function useSelectedSource(): { sourceId: string | null; source: SourceRow | null; listLoaded: boolean } {
  const { data, nav } = useHelm()
  const sourceId = nav.location.selection.source
  const rows = data.resources.sources.data
  return { sourceId, source: sourceId ? (rows?.find(row => row.id === sourceId) ?? null) : null, listLoaded: rows !== null }
}

function statusSummary(source: SourceRow): string {
  const status = source.status.replaceAll('_', ' ')
  return source.errorMessage ? `Status: ${status}. Last error: ${source.errorMessage}` : `Status: ${status}.`
}

function statusImpact(source: SourceRow): string {
  switch (source.status) {
    case 'error': return `${source.name} may not be getting fresh listings until a scrape succeeds.`
    case 'needs_remapping': return `${source.name} cannot extract listings reliably until its mapping is repaired.`
    case 'paused': return `${source.name} is paused, so it is not being scraped. That may be intentional.`
    case 'disabled': return `${source.name} is disabled and not contributing new listings.`
    default: return `No source-level problem is recorded for ${source.name}.`
  }
}

export function SourceView() {
  const { sourceId, source, listLoaded } = useSelectedSource()
  const { brief } = useSelectedProblem()
  if (sourceId === null) return null

  return (
    <>
      <InspectorSection title="What happened">
        {source ? (
          <>
            <p className={styles.prose}>{statusSummary(source)}</p>
            <Facts
              items={[
                ['Last scraped', <RelativeTimestamp key="s" value={source.lastScrapedAt} fallback="never" />],
                ['Last full crawl', <RelativeTimestamp key="c" value={source.lastFullCrawlAt} fallback="never" />],
                ['Listing counter', `${source.listingCount.toLocaleString()} (source-reported rows, not unique vehicles)`],
                ['Possibly gone', source.possiblyGoneCount.toLocaleString()],
              ]}
            />
          </>
        ) : (
          <Notice tone="warning">
            {listLoaded ? `Source ${sourceId} is not in the loaded source list.` : 'The source list is unavailable, so this source cannot be described.'}
          </Notice>
        )}
      </InspectorSection>
      <InspectorSection title="Impact">
        <p className={styles.prose}>
          {brief && brief.scope.sourceId === sourceId ? brief.impact.text : source ? statusImpact(source) : 'Impact unknown: the source is not loaded.'}
        </p>
      </InspectorSection>
      <InspectorSection title="Evidence">
        <SourceEvidenceGroups />
        <p className={styles.reason}><Link href={`/ops/sources/${encodeURIComponent(sourceId)}`}>Open the legacy source pipeline page</Link></p>
      </InspectorSection>
      <InspectorSection title="Actions">
        <SourceActions sourceId={sourceId} />
      </InspectorSection>
    </>
  )
}
