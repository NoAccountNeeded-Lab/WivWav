'use client'

import { useState } from 'react'
import { Link2, X } from 'lucide-react'
import { useHelm } from '../helm-context'
import type { HelmFocusKind } from '../helm-url'
import styles from './helm-inspector.module.css'

export interface Crumb {
  kind: HelmFocusKind
  label: string
}

interface InspectorFrameProps {
  titleId: string
  title: string
  crumbs: Crumb[]
  focus: HelmFocusKind
  onClose: () => void
  children: React.ReactNode
}

const KIND_LABEL: Record<HelmFocusKind, string> = { problem: 'Problem', source: 'Source', run: 'Run', log: 'Log' }

/** Header (title, close, copy link), breadcrumb path through the selection chain, then the inspector body. */
export function InspectorFrame({ titleId, title, crumbs, focus, onClose, children }: InspectorFrameProps) {
  const { nav } = useHelm()
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${nav.shareHref}`)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className={styles.frame}>
      <header className={styles.frameHeader}>
        <h2 id={titleId} tabIndex={-1} className={styles.frameTitle}>{title}</h2>
        <button type="button" className={styles.iconButton} onClick={() => void copyLink()}>
          <Link2 size={16} aria-hidden="true" />
          Copy link
        </button>
        <button type="button" className={styles.iconButton} onClick={onClose}>
          <X size={16} aria-hidden="true" />
          Close
        </button>
      </header>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {copied === 'copied' ? 'Link copied' : copied === 'failed' ? 'Could not copy the link' : ''}
      </p>
      {copied !== 'idle' && <p className={styles.copyNote} aria-hidden="true">{copied === 'copied' ? 'Link copied' : 'Could not copy the link'}</p>}
      {crumbs.length > 1 && (
        <nav aria-label="Selection path">
          <ol className={styles.crumbs}>
            {crumbs.map(crumb => (
              <li key={crumb.kind}>
                <button
                  type="button"
                  className={styles.crumbButton}
                  aria-current={crumb.kind === focus ? 'true' : undefined}
                  onClick={() => nav.focusLevel(crumb.kind)}
                >
                  <span className={styles.crumbKind}>{KIND_LABEL[crumb.kind]}:</span> {crumb.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className={styles.frameBody}>{children}</div>
    </div>
  )
}
