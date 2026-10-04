'use client'

import { useRef, useState } from 'react'
import { useHelm } from './helm-context'
import { ActionOutcomeList } from './ActionOutcomeList'
import { Notice } from './primitives'
import styles from './inspector/helm-inspector.module.css'

/**
 * Full search-index rebuild. It is global (not tied to a source) and heavy,
 * so it needs an explicit confirmation step before anything is enqueued.
 */
export function SearchRebuildPanel() {
  const { tracker } = useHelm()
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLHeadingElement | null>(null)
  const busy = tracker.isBusy('search-rebuild', null)
  const related = tracker.actions.filter(action => action.kind === 'search-rebuild')

  function openConfirm() {
    setConfirming(true)
    window.setTimeout(() => confirmRef.current?.focus(), 0)
  }

  function closeConfirm() {
    setConfirming(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  function confirm() {
    void tracker.rebuildSearch()
    closeConfirm()
  }

  return (
    <div className={styles.frameBody}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.actionButton}
        aria-disabled={busy ? 'true' : undefined}
        aria-describedby="helm-rebuild-reason"
        onClick={() => { if (!busy) openConfirm() }}
      >
        Rebuild search index…
      </button>
      <p id="helm-rebuild-reason" className={styles.reason}>
        {busy ? 'A rebuild is already queued or running.' : 'Use when search is unavailable, empty or out of date. This is global, not per source.'}
      </p>
      {confirming && (
        <div role="group" aria-labelledby="helm-rebuild-confirm" className={styles.confirm}>
          <h4 id="helm-rebuild-confirm" ref={confirmRef} tabIndex={-1} className={styles.sectionTitle}>Rebuild the whole search index?</h4>
          <Notice tone="warning">
            This re-indexes every listing from the database into a new search index and swaps it in when done. It does not change listings, but it is heavy and the API allows only 5 requests a minute.
          </Notice>
          <div className={styles.actionRow}>
            <button type="button" className={styles.actionButton} data-variant="danger" onClick={confirm}>Rebuild now</button>
            <button type="button" className={styles.actionButton} onClick={closeConfirm}>Cancel</button>
          </div>
        </div>
      )}
      <ActionOutcomeList actions={related} label="Search rebuild requests" />
    </div>
  )
}
