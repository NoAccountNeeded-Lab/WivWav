'use client'

import { useState } from 'react'
import type { ProblemState } from '@wivwav/types'
import { setProblemAcknowledged } from '../action-client'
import { useHelm } from '../helm-context'
import { isAcknowledged } from '../../ops/problem-presentation'
import styles from './helm-inspector.module.css'

type AckState = { phase: 'idle' } | { phase: 'saving' } | { phase: 'done'; message: string } | { phase: 'error'; message: string }

/**
 * Acknowledge / unacknowledge through the existing problem-ack endpoint.
 * Acknowledged means *reviewed* — the problem keeps being reported and the
 * workspace status does not turn healthy because of it.
 */
export function ProblemActions({ problem }: { problem: ProblemState }) {
  const { apiBaseUrl, data } = useHelm()
  const [state, setState] = useState<AckState>({ phase: 'idle' })
  const acknowledged = isAcknowledged(problem)

  async function toggle() {
    if (state.phase === 'saving') return
    setState({ phase: 'saving' })
    const result = await setProblemAcknowledged(apiBaseUrl, problem.fingerprint, !acknowledged)
    if (!result.ok) {
      setState({ phase: 'error', message: `${result.message}${result.status ? ` (HTTP ${result.status})` : ''}. The review state was not changed.` })
      return
    }
    setState({ phase: 'done', message: acknowledged ? 'Marked as not reviewed.' : 'Marked as reviewed.' })
    void data.problems.retry()
  }

  return (
    <div className={styles.listItem}>
      <button
        type="button"
        className={styles.actionButton}
        aria-disabled={state.phase === 'saving' ? 'true' : undefined}
        onClick={() => void toggle()}
      >
        {state.phase === 'saving' ? 'Saving…' : acknowledged ? 'Unacknowledge (mark not reviewed)' : 'Acknowledge (mark reviewed)'}
      </button>
      <p className={styles.reason}>Acknowledging means a person reviewed it. It does not repair anything and the problem stays listed.</p>
      <p className={styles.reason} role={state.phase === 'error' ? 'alert' : 'status'}>
        {state.phase === 'done' || state.phase === 'error' ? state.message : ''}
      </p>
    </div>
  )
}
