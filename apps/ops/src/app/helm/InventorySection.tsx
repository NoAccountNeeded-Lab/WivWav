import type { HelmCountReading, HelmSummary } from '@wivwav/types'
import { OpsStatusChip } from '@/components/OpsStatusChip'
import type { Freshness } from './helm-freshness'
import { FreshnessChip, Notice, Timestamp } from './primitives'
import { SearchRebuildPanel } from './SearchRebuildPanel'
import styles from './helm-sections.module.css'

interface InventorySectionProps {
  summary: HelmSummary | null
  freshness: Freshness
  error: string | null
}

const COUNTS: ReadonlyArray<{ key: keyof HelmSummary['counts']; label: string; definition: string }> = [
  { key: 'stored', label: 'Stored listings', definition: 'Every listing row in the database, whatever its status.' },
  { key: 'active', label: 'Active listings', definition: 'Listing rows currently observed as active, whether or not they are published.' },
  { key: 'eligible', label: 'Eligible listings', definition: 'Active listing rows that are also eligible to be published in search results.' },
  { key: 'indexed', label: 'Indexed documents', definition: 'Documents currently in the search index. The index holds one representative document per vehicle group, so it can be lower than eligible listings.' },
]

function CountCard({ label, definition, reading }: { label: string; definition: string; reading: HelmCountReading | null }) {
  const available = reading !== null && reading.availability === 'available' && reading.value !== null
  return (
    <li className={styles.card}>
      <h3 className={styles.cardLabel}>{label}</h3>
      <p className={styles.cardValue} data-unavailable={available ? undefined : 'true'}>
        {available ? (reading.value as number).toLocaleString() : 'Unavailable'}
      </p>
      <p className={styles.cardMeta}>
        {available ? <Timestamp value={reading.collectedAt} label="Read" /> : 'This reading failed. It is not zero.'}
      </p>
      <details className={styles.definition}>
        <summary>What does this count?</summary>
        <p>{definition} Counts listing rows or search documents, never unique vehicles.</p>
      </details>
    </li>
  )
}

export function InventorySection({ summary, freshness, error }: InventorySectionProps) {
  return (
    <>
      <div className={styles.sectionHeader}>
        <FreshnessChip freshness={freshness} />
      </div>
      <Notice>
        Four independent readings. They are collected separately, so they are not an atomic snapshot and may legitimately differ.
      </Notice>
      {summary === null ? (
        <Notice tone="warning">
          Inventory counts are unavailable{error ? ` (${error})` : ''}. No counts are shown rather than guessing zero.
        </Notice>
      ) : (
        <>
          {freshness === 'stale' && (
            <Notice tone="warning">
              Showing the last successful readings from <Timestamp value={summary.collectedAt} label="" />. The latest refresh failed or is overdue{error ? `: ${error}` : ''}.
            </Notice>
          )}
          <ul className={styles.cardGrid} aria-label="Inventory counts">
            {COUNTS.map(({ key, label, definition }) => (
              <CountCard key={key} label={label} definition={definition} reading={summary.counts[key]} />
            ))}
          </ul>
          <ul className={styles.availabilityRow} aria-label="Data source availability">
            <li>
              <OpsStatusChip
                variant={summary.availability.database === 'available' ? 'success' : 'danger'}
                label={`Database: ${summary.availability.database}`}
              />
            </li>
            <li>
              <OpsStatusChip
                variant={summary.availability.search === 'available' ? 'success' : 'danger'}
                label={`Search: ${summary.availability.search}`}
              />
            </li>
          </ul>
        </>
      )}
      <SearchRebuildPanel />
    </>
  )
}
