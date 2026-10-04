'use client'

import { useEffect, useRef, useState } from 'react'
import { useHelm } from './helm-context'
import { recoveryStateLabel } from './recovery'
import { outcomeLabel } from './tracked-action'
import shell from './helm-shell.module.css'

/**
 * One polite live region for action progress (WCAG 4.1.3). Outcome and
 * recovery changes arrive while focus is elsewhere, so each change is
 * announced as a short sentence. It lives outside the inert page wrapper so
 * it still speaks while the narrow-screen dialog is open, and it is a single
 * region so the same update is never announced twice.
 */
export function ActionAnnouncer() {
  const { tracker } = useHelm()
  const [message, setMessage] = useState('')
  const seen = useRef(new Map<string, string>())

  useEffect(() => {
    const lines: string[] = []
    for (const action of tracker.actions) {
      const verdict = action.jobId ? tracker.verdictFor(action) : null
      const signature = `${action.outcome}|${verdict?.state ?? ''}`
      if (seen.current.get(action.id) === signature) continue
      seen.current.set(action.id, signature)
      const subject = `${action.label}${action.sourceName ? `: ${action.sourceName}` : ''}`
      const verdictText = verdict && verdict.state !== 'pending-job' ? `. ${recoveryStateLabel(verdict.state)}. ${verdict.headline}` : ''
      lines.push(`${subject}. ${outcomeLabel(action.outcome)}${verdictText}`)
    }
    if (lines.length > 0) setMessage(lines.join(' '))
  }, [tracker])

  return <div className={shell.srOnly} role="status" aria-live="polite" data-testid="action-announcer">{message}</div>
}
