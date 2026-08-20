'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ACTION_ICONS } from '../action-icons'
import { RelativeTimestamp } from '@/lib/relative-time'
import styles from '../ops.module.css'

interface AuditEntry {
  listingId: string
  action: 'automated-retention' | 'operator-request'
  outcome: 'applied' | 'skipped-already-applied' | 'failed'
  fieldsCleared: string[]
  reason: string | null
  requestedBy: string | null
  errorMessage: string | null
  updatedAt: string
}

interface PrivacyRequestsClientProps {
  apiBaseUrl: string
}

function outcomeVariant(outcome: AuditEntry['outcome']): string {
  if (outcome === 'applied') return 'success'
  if (outcome === 'failed') return 'danger'
  return 'neutral'
}

function actionLabel(action: AuditEntry['action']): string {
  return action === 'operator-request' ? 'Operator request' : 'Automated sweep'
}

export function PrivacyRequestsClient({ apiBaseUrl }: PrivacyRequestsClientProps) {
  const [listingId, setListingId] = useState('')
  const [reason, setReason] = useState('')
  const [requestedBy, setRequestedBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitFeedback, setSubmitFeedback] = useState<{ message: string; isError: boolean } | null>(null)

  const [auditListingId, setAuditListingId] = useState('')
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)

  async function loadAudit(id: string) {
    const trimmed = id.trim()
    if (!trimmed) return
    setAuditLoading(true)
    setAuditError(null)
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/private-seller-retention/listings/${encodeURIComponent(trimmed)}/audit`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const body = (await res.json()) as { data: AuditEntry[] }
      setAuditEntries(body.data)
      setAuditListingId(trimmed)
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load deletion history')
      setAuditEntries(null)
    } finally {
      setAuditLoading(false)
    }
  }

  async function submitDeletion() {
    const trimmedId = listingId.trim()
    if (!trimmedId) {
      setSubmitFeedback({ message: 'Enter a listing ID before submitting.', isError: true })
      return
    }

    setSubmitting(true)
    setSubmitFeedback(null)
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/private-seller-retention/listings/${encodeURIComponent(trimmedId)}/delete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reason: reason.trim() || undefined,
            requestedBy: requestedBy.trim() || undefined,
          }),
        },
      )
      const body = (await res.json()) as { data?: { outcome: string }; error?: { message: string } }

      if (!res.ok) {
        throw new Error(body.error?.message ?? `Request failed (${res.status})`)
      }

      setSubmitFeedback({
        message:
          body.data?.outcome === 'skipped-already-applied'
            ? 'Already anonymized — no sensitive fields remained to clear.'
            : 'Listing anonymized: sensitive fields cleared, images and raw-page evidence deleted, and it was removed from search.',
        isError: false,
      })
      await loadAudit(trimmedId)
    } catch (err) {
      setSubmitFeedback({ message: err instanceof Error ? err.message : 'Deletion request failed', isError: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>Private-seller deletion requests</h1>
            <p className={styles.pageIntro}>
              Immediately anonymize one private-seller listing — clears phone, name, description, ZIP, and images;
              deletes its raw-page evidence and image references; removes it from search. Use this for a seller
              request received at privacy@wivwav.com. Gone listings past the 30-day retention window are anonymized
              automatically by the scheduled sweep without operator action.
            </p>
          </div>
          <Link href="/ops" className={styles.backLink}>← Operations</Link>
        </div>

        <div className={styles.formPanel}>
          <h3 className={styles.subsectionHeading}>Submit a deletion request</h3>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Listing ID</span>
              <input
                type="text"
                className={styles.input}
                value={listingId}
                onChange={event => setListingId(event.target.value)}
                placeholder="clxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reason (optional)</span>
              <input
                type="text"
                className={styles.input}
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="Seller requested removal via privacy@wivwav.com"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Requested by (optional)</span>
              <input
                type="text"
                className={styles.input}
                value={requestedBy}
                onChange={event => setRequestedBy(event.target.value)}
                placeholder="Operator name or identifier"
              />
            </label>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => void submitDeletion()}
              disabled={submitting}
            >
              <ACTION_ICONS.delete size={13} aria-hidden="true" />
              {submitting ? 'Deleting…' : 'Delete private-seller data'}
            </button>
            <span
              role={submitFeedback?.isError ? 'alert' : 'status'}
              aria-live={submitFeedback?.isError ? 'assertive' : 'polite'}
              aria-atomic="true"
              className={submitFeedback?.isError ? styles.errorMsg : styles.muted}
            >
              {submitFeedback?.message ?? ''}
            </span>
          </div>
        </div>

        <section className={styles.sectionBlock} aria-labelledby="audit-heading">
          <h2 id="audit-heading" className={styles.sectionHeading}>Deletion history</h2>
          <p className={styles.sectionIntro}>
            Every automated sweep attempt and operator request for a listing, newest first — evidence for what was
            cleared and when, including failures the next sweep will retry.
          </p>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Listing ID</span>
              <input
                type="text"
                className={styles.input}
                defaultValue={auditListingId}
                onChange={event => setAuditListingId(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void loadAudit(auditListingId)
                }}
                placeholder="clxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </label>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => void loadAudit(auditListingId)}
              disabled={auditLoading}
            >
              <ACTION_ICONS.refresh size={13} aria-hidden="true" />
              {auditLoading ? 'Loading…' : 'Look up history'}
            </button>
          </div>

          {auditError ? (
            <p className={styles.error}>Deletion history could not load: {auditError}.</p>
          ) : auditEntries === null ? (
            <p className={styles.emptyCompact}>Enter a listing ID above to view its deletion history.</p>
          ) : auditEntries.length === 0 ? (
            <p className={styles.emptyCompact}>No deletion-lifecycle activity recorded for this listing yet.</p>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Source</th>
                    <th>Outcome</th>
                    <th>Fields cleared</th>
                    <th>Reason / error</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry, index) => (
                    <tr key={`${entry.updatedAt}-${index}`}>
                      <td className={styles.muted}><RelativeTimestamp value={entry.updatedAt} fallback="Unknown" /></td>
                      <td>{actionLabel(entry.action)}</td>
                      <td>
                        <span className={styles.badge} data-variant={outcomeVariant(entry.outcome)}>
                          {entry.outcome}
                        </span>
                      </td>
                      <td className={styles.muted}>{entry.fieldsCleared.length > 0 ? entry.fieldsCleared.join(', ') : '-'}</td>
                      <td className={entry.errorMessage ? styles.errorMsg : styles.muted}>
                        {entry.errorMessage ?? entry.reason ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
