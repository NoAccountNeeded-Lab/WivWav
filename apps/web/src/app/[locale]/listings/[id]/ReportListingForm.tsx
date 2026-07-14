'use client'

import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Flag } from 'lucide-react'
import styles from './tabs.module.css'

type ReportType = 'specs_incorrect' | 'sold_or_stale' | 'duplicate' | 'other'

const REPORT_TYPES: Array<{ value: ReportType; label: string }> = [
  { value: 'specs_incorrect', label: 'Specs incorrect' },
  { value: 'sold_or_stale', label: 'Listing is sold or stale' },
  { value: 'duplicate', label: 'Duplicate listing' },
  { value: 'other', label: 'Other' },
]

interface ReportListingFormProps {
  listingId: string
  apiBaseUrl: string
}

export function ReportListingForm({ listingId, apiBaseUrl }: ReportListingFormProps) {
  const formId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [reportType, setReportType] = useState<ReportType | ''>('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    if (!reportType) {
      setStatus({ kind: 'error', message: 'Choose what looks wrong before submitting.' })
      return
    }

    setIsSubmitting(true)
    setStatus(null)
    try {
      const response = await fetch(`${apiBaseUrl}/v1/listings/${encodeURIComponent(listingId)}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType,
          notes: notes.trim() || undefined,
        }),
      })
      if (!response.ok) {
        throw new Error('Report submission failed')
      }
      setStatus({ kind: 'success', message: 'Thanks. We recorded this report for review.' })
      setNotes('')
      setReportType('')
    } catch {
      setStatus({ kind: 'error', message: 'We could not submit the report. Try again in a moment.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className={styles.reportSection} aria-labelledby={`${formId}-heading`}>
      <button
        type="button"
        className={styles.reportToggle}
        aria-expanded={isOpen}
        aria-controls={`${formId}-form`}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Flag size={16} aria-hidden />
        <span id={`${formId}-heading`}>Report an issue</span>
      </button>

      {isOpen && (
        <form id={`${formId}-form`} className={styles.reportForm} onSubmit={submitReport}>
          <div className={styles.reportField}>
            <label htmlFor={`${formId}-type`} className={styles.reportLabel}>What looks wrong?</label>
            <select
              id={`${formId}-type`}
              className={styles.reportSelect}
              value={reportType}
              disabled={isSubmitting}
              onChange={(event) => setReportType(event.target.value as ReportType | '')}
            >
              <option value="">Choose an issue</option>
              {REPORT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.reportField}>
            <label htmlFor={`${formId}-notes`} className={styles.reportLabel}>Notes, optional</label>
            <textarea
              id={`${formId}-notes`}
              className={styles.reportTextarea}
              value={notes}
              disabled={isSubmitting}
              maxLength={1000}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {status && (
            <p
              className={status.kind === 'success' ? styles.reportSuccess : styles.reportError}
              role={status.kind === 'error' ? 'alert' : 'status'}
            >
              {status.kind === 'error' && <AlertTriangle size={14} aria-hidden />}
              {status.message}
            </p>
          )}

          <button type="submit" className={styles.reportSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Submit report'}
          </button>
        </form>
      )}
    </section>
  )
}
