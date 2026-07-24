'use client'

import { useEffect, useRef, useState } from 'react'
import styles from '../ops.module.css'
import { ACTION_ICONS } from '../action-icons'
import {
  initialPullState, applyPullLine, parsePullLine, splitNdjsonChunk, type PullState,
} from './pull-progress'

interface ModelPullButtonProps {
  modelName: string
  /** Called once the pull completes successfully so the parent can refresh installed models. */
  onInstalled: () => void
}

/**
 * Pull/Download button for a catalog model that isn't installed yet (#250).
 * Streams `POST /api/ollama/pull`'s NDJSON body and renders live layer
 * download progress in place — no page reload.
 */
export function ModelPullButton({ modelName, onInstalled }: ModelPullButtonProps) {
  const [pulling, setPulling] = useState(false)
  const [state, setState] = useState<PullState>(initialPullState())
  const abortRef = useRef<AbortController | null>(null)

  // Cancel any in-flight pull if this row unmounts (e.g. the model list
  // re-renders after `onInstalled` swaps the cell to the "Installed" badge)
  // so the stream reader loop doesn't keep running against a gone component.
  useEffect(() => () => abortRef.current?.abort(), [])

  async function handlePull() {
    const controller = new AbortController()
    abortRef.current = controller

    setPulling(true)
    setState(initialPullState())

    try {
      const res = await fetch('/api/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        let message = `Request failed (${res.status})`
        try {
          const errBody = await res.json() as { error?: { message?: string } }
          message = errBody.error?.message ?? message
        } catch {
          // non-JSON error body — keep the generic message
        }
        setState(prev => ({ ...prev, error: message, done: true }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break

        const { lines, buffer: nextBuffer } = splitNdjsonChunk(buffer, decoder.decode(value, { stream: true }))
        buffer = nextBuffer

        for (const raw of lines) {
          const parsed = parsePullLine(raw)
          if (!parsed) continue
          setState(prev => applyPullLine(prev, parsed))
          if (parsed.status === 'success') onInstalled()
        }
      }

      // Flush any trailing partial line left in the decoder/buffer.
      const finalChunk = decoder.decode()
      const { lines: finalLines } = splitNdjsonChunk(buffer, finalChunk)
      for (const raw of finalLines) {
        const parsed = parsePullLine(raw)
        if (!parsed) continue
        setState(prev => applyPullLine(prev, parsed))
        if (parsed.status === 'success') onInstalled()
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Pull failed',
        done: true,
      }))
    } finally {
      setPulling(false)
    }
  }

  const showProgress = pulling || (state.status && !state.error)
  const succeeded = state.status === 'success' && !state.error
  const percent = state.overallPercent ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '12rem' }}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        onClick={() => void handlePull()}
        disabled={pulling}
        aria-label={`Pull model ${modelName}`}
      >
        <ACTION_ICONS.download size={13} aria-hidden="true" />
        {pulling ? 'Pulling…' : succeeded ? 'Pulled' : 'Pull'}
      </button>

      {state.error ? (
        // Announced once when the pull fails — not on every progress tick.
        <span role="status" aria-live="polite" aria-atomic="true" className={styles.errorMsg} style={{ fontSize: '0.75rem' }}>
          {state.error}
        </span>
      ) : showProgress ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {/*
            The live region only carries the phase text ("pulling manifest",
            "verifying sha256 digest", "success", …), which changes at most
            once per layer/phase transition. The percentage is exposed via
            the progressbar's aria-valuenow instead of being appended here,
            so a screen reader isn't forced to re-announce a new number on
            every NDJSON line (Ollama can emit several per second per layer).
          */}
          <span role="status" aria-live="polite" aria-atomic="true" className={styles.muted} style={{ fontSize: '0.75rem' }}>
            {succeeded ? 'Installed ✓' : state.status || 'Starting…'}
          </span>
          {!succeeded && (
            <span
              role="progressbar"
              aria-label={`Download progress for ${modelName}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className={styles.pullProgressTrack}
            >
              <span className={styles.pullProgressFill} style={{ width: `${percent}%` }} />
            </span>
          )}
        </span>
      ) : null}
    </div>
  )
}
