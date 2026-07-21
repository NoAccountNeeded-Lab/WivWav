'use client'

import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Flag, MessageCircleQuestion } from 'lucide-react'
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
  const [isAvailabilitySubmitting, setIsAvailabilitySubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function createReport(input: { reportType: ReportType; notes?: string }) {
    const response = await fetch(`${apiBaseUrl}/v1/listings/${encodeURIComponent(listingId)}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error('Report submission failed')
    }
  }

  async function submitAvailabilityReport() {
    if (isAvailabilitySubmitting || isSubmitting) return

    setIsAvailabilitySubmitting(true)
    setStatus(null)
    try {
      await createReport({
        reportType: 'sold_or_stale',
        notes: 'Buyer asked whether this listing is still available.',
      })
      setStatus({ kind: 'success', message: 'Thanks. We flagged this listing for availability review.' })
    } catch {
      setStatus({ kind: 'error', message: 'We could not flag availability. Try again in a moment.' })
    } finally {
      setIsAvailabilitySubmitting(false)
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || isAvailabilitySubmitting) return
    if (!reportType) {
      setStatus({ kind: 'error', message: 'Choose what looks wrong before submitting.' })
      return
    }

    setIsSubmitting(true)
    setStatus(null)
    try {
      await createReport({
        reportType,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
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
    <section className={styles.reportSection} aria-label="Report an issue">
      <button
        type="button"
        className={styles.availabilityReportButton}
        disabled={isAvailabilitySubmitting || isSubmitting}
        onClick={submitAvailabilityReport}
      >
        <MessageCircleQuestion size={16} aria-hidden />
        {isAvailabilitySubmitting ? 'Checking availability...' : 'Is this listing still available?'}
      </button>

      <div className={styles.reportButtonWrap}>
        <button
          type="button"
          className={styles.reportToggle}
          aria-expanded={isOpen}
          aria-controls={`${formId}-form`}
          aria-label="Report an issue"
          onClick={() => setIsOpen((open) => !open)}
        >
          <Flag size={18} aria-hidden />
        </button>
        <span className={styles.reportTooltip} aria-hidden="true">Report an issue</span>
      </div>

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

          <button type="submit" className={styles.reportSubmit} disabled={isSubmitting || isAvailabilitySubmitting}>
            {isSubmitting ? 'Submitting...' : 'Submit report'}
          </button>
        </form>
      )}

      {status && (
        <p
          className={status.kind === 'success' ? styles.reportSuccess : styles.reportError}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.kind === 'error' && <AlertTriangle size={14} aria-hidden />}
          {status.message}
        </p>
      )}
    </section>
  )
}
