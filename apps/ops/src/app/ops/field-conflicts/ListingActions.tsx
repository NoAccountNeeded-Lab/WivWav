'use client'

import { useEffect, useState } from 'react'
import styles from '../ops.module.css'
import { ACTION_ICONS } from '../action-icons'

type Action = 'requeue-resolve' | 'hide' | 'unhide' | 'mark-gone' | 'release-quarantine'

const BUTTONS: { action: Action; label: string; icon: keyof typeof ACTION_ICONS; confirm: string; needsReason?: boolean }[] = [
  { action: 'requeue-resolve', label: 'Re-run validation', icon: 'refresh', confirm: 'Queue a fresh validation for this listing?' },
  { action: 'release-quarantine', label: 'Release from quarantine', icon: 'releaseQuarantine', confirm: 'Release this listing from quarantine and re-validate it?' },
  { action: 'hide', label: 'Hide from public', icon: 'hideListing', confirm: 'Hide this listing from search and the public site?', needsReason: true },
  { action: 'unhide', label: 'Restore hidden listing', icon: 'unhideListing', confirm: 'Restore this listing and re-validate it?' },
  { action: 'mark-gone', label: 'Mark as gone', icon: 'markGone', confirm: 'Mark this listing as gone?' },
]

/** #1157 per-listing operator actions: icon buttons with accessible names and an in-page confirm. */
export function ListingActions({ listingId, apiBaseUrl }: { listingId: string; apiBaseUrl: string }) {
  const [pending, setPending] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null)
  const current = BUTTONS.find((b) => b.action === pending)

  const controlId = (action: Action) => `listing-${listingId}-${action}`
  // Safe choice first: move focus into the confirm when it opens.
  useEffect(() => {
    if (pending) document.getElementById(`${controlId(pending)}-cancel`)?.focus()
  }, [pending])

  function escapeToOpener(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && pending) { setPending(null); document.getElementById(controlId(pending))?.focus() }
  }

  async function run(action: Action) {
    setPending(null)
    // The confirm unmounts; hand focus back to the control that opened it.
    document.getElementById(controlId(action))?.focus()
    try {
      const res = await fetch(`${apiBaseUrl}/internal/ops/listings/${encodeURIComponent(listingId)}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'hide' ? { reason } : {}) }),
      })
      const body = (await res.json().catch(() => null)) as { data?: { message?: string; jobId?: string | null }; error?: { message?: string } } | null
      if (!res.ok) setFeedback({ message: body?.error?.message ?? `Failed (${res.status})`, isError: true })
      else setFeedback({ message: `${body?.data?.message ?? 'Done'}${body?.data?.jobId ? ` (job ${body.data.jobId})` : ''}`, isError: false })
      setReason('')
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'Error', isError: true })
    }
  }

  return (
    <div>
      <div role="group" aria-label={`Actions for listing ${listingId}`} style={{ display: 'flex', gap: '0.25rem' }}>
        {BUTTONS.map(({ action, label, icon }) => {
          const Icon = ACTION_ICONS[icon]
          return (
            <button
              key={action}
              id={controlId(action)}
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => { setFeedback(null); setPending(action) }}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {current && (
        <div role="group" aria-label={`Confirm: ${current.label}`} style={{ marginTop: '0.375rem' }}>
          <span>{current.confirm}</span>
          {current.needsReason && (
            <label style={{ display: 'block' }}>
              Reason
              <input type="text" value={reason} maxLength={500} onKeyDown={escapeToOpener} onChange={(e) => setReason(e.target.value)} style={{ marginLeft: '0.375rem' }} />
            </label>
          )}
          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            type="button"
            onKeyDown={escapeToOpener}
            disabled={current.needsReason && reason.trim() === ''}
            onClick={() => void run(current.action)}
          >
            Confirm
          </button>
          <button
            id={`${controlId(current.action)}-cancel`}
            className={`${styles.btn} ${styles.btnGhost}`}
            type="button"
            onKeyDown={escapeToOpener}
            onClick={() => { setPending(null); document.getElementById(controlId(current.action))?.focus() }}
          >
            Cancel
          </button>
        </div>
      )}
      {feedback && <p role={feedback.isError ? 'alert' : 'status'} className={feedback.isError ? styles.error : styles.refreshMeta}>{feedback.message}</p>}
    </div>
  )
}
