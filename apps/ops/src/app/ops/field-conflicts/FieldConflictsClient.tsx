'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'
import { ACTION_ICONS } from '../action-icons'

/**
 * One #499 field-resolution conflict: a listing whose conversionType or
 * rampType has two or more disagreeing credible claims. Mirrors
 * `FieldConflictRow` (apps/api/src/repositories/listing-repository.ts).
 */
interface FieldConflictRow {
  listingId: string
  sourceUrl: string
  make: string
  model: string
  year: number
  field: string
  competingValues: string[]
  evidenceKinds: string[]
  sourceRefs: (string | null)[]
  observedAts: string[]
  detectedAt: string
}

interface FieldConflictsClientProps {
  apiBaseUrl: string
}

const REFRESH_MS = 30_000
const PAGE_SIZE = 50

const FIELD_LABEL: Record<string, string> = {
  conversionType: 'Entry type',
  rampType: 'Ramp type',
}

function fmtTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function FieldConflictsClient({ apiBaseUrl }: FieldConflictsClientProps) {
  const [rows, setRows] = useState<FieldConflictRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [skip, setSkip] = useState(0)
  const [fieldFilter, setFieldFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) })
      if (fieldFilter) params.set('field', fieldFilter)
      const res = await fetch(`${apiBaseUrl}/admin/field-conflicts?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: FieldConflictRow[]; meta: { total: number } }
      setRows(body.data)
      setTotal(body.meta.total)
      setError(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load field conflicts')
    } finally {
      setIsRefreshing(false)
    }
  }, [apiBaseUrl, skip, fieldFilter])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Field conflicts</h1>
            <p className={styles.pageIntro}>
              Listings whose entry type or ramp type has conflicting evidence (#499) — the public
              value reads &quot;unknown&quot; and is excluded from side/rear and ramp-type search
              filters until an operator or a later scrape resolves it.
            </p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.controlsBar}>
          <span className={styles.refreshMeta}>
            {updatedAt ? `Updated ${fmtTime(updatedAt)} · ${total} unresolved` : 'Loading…'}
          </span>
          <div className={styles.controlsBarRight}>
            <label htmlFor="field-conflicts-field-filter" style={{ fontSize: '0.8rem' }}>
              Field
              <select
                id="field-conflicts-field-filter"
                value={fieldFilter}
                onChange={(e) => { setSkip(0); setFieldFilter(e.target.value) }}
                style={{ marginLeft: '0.375rem' }}
              >
                <option value="">All</option>
                <option value="conversionType">Entry type</option>
                <option value="rampType">Ramp type</option>
              </select>
            </label>
            <button className={`${styles.btn} ${styles.btnGhost}`} type="button" onClick={() => void refresh()} disabled={isRefreshing}>
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <p className={styles.error}>Field conflicts could not load: {error}. Check the API, then refresh this page.</p>
        ) : !rows ? (
          <p className={styles.empty}>Loading field conflicts. If this does not finish, confirm the API is running and refresh.</p>
        ) : !rows.length ? (
          <p className={styles.empty}>No unresolved field conflicts. Every active listing&apos;s entry/ramp type is either verified, source-reported, or unknown from lack of evidence.</p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Field</th>
                  <th>Competing values</th>
                  <th>Evidence</th>
                  <th className={styles.num}>Observed</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.listingId}:${row.field}`}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{row.year} {row.make} {row.model}</span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--clr-text-muted)' }}>{row.listingId}</div>
                    </td>
                    <td>{FIELD_LABEL[row.field] ?? row.field}</td>
                    <td>
                      {row.competingValues.map((value, i) => (
                        <span key={`${value}-${i}`} className={styles.badge} data-variant="warning" style={{ marginRight: '0.25rem' }}>
                          {value}
                        </span>
                      ))}
                    </td>
                    <td>{row.evidenceKinds.join(', ')}</td>
                    <td className={styles.num}>
                      <RelativeTimestamp value={row.detectedAt} />
                    </td>
                    <td>
                      <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">
                        View listing
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className={styles.controlsBar}>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
              disabled={skip === 0}
            >
              ← Previous
            </button>
            <span className={styles.refreshMeta}>
              {skip + 1}–{skip + rows.length} of {total}
            </span>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              onClick={() => setSkip((s) => s + PAGE_SIZE)}
              disabled={skip + rows.length >= total}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
