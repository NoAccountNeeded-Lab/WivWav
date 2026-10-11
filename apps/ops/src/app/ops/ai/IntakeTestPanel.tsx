'use client'

import type { IntakeFilters } from '@wivwav/types'
import { useRef, useState, useTransition } from 'react'
import styles from '../ops.module.css'
import { MetaTable, OllamaErrorMsg, RawResponse, SampleButtons, colHead, panelGrid, type OllamaMeta } from './jobTestShared'

const INTAKE_SAMPLES = [
  {
    label: 'Rear-entry ramp',
    text: 'I use a power wheelchair and need a rear-entry van with an in-floor ramp. Looking for a used vehicle under $40,000 in Texas.',
  },
  {
    label: 'Side-entry, hand controls',
    text: 'Need a side-entry conversion van with hand controls. New or certified pre-owned, budget up to $60,000. Based in California.',
  },
  {
    label: 'Platform lift',
    text: 'Looking for a minivan with a platform lift — my wife uses a heavy power chair. Prefer certified pre-owned in Florida, under $55k.',
  },
  {
    label: 'Fold-out ramp, budget',
    text: 'Any entry type is fine, fold-out ramp preferred. Used vehicle, max $30,000, somewhere in Ohio.',
  },
]

export function IntakeTestPanel() {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{
    filters: IntakeFilters
    rawText: string
    ollamaError: string
    meta?: OllamaMeta
    raw: unknown
    durationMs: number
    error?: string
  } | null>(null)

  function fill(i: number) {
    const s = INTAKE_SAMPLES[i]
    if (ref.current && s) ref.current.value = s.text
  }
  function fillRandom() {
    fill(Math.floor(Math.random() * INTAKE_SAMPLES.length))
  }

  function run() {
    const description = ref.current?.value.trim() ?? ''
    if (!description) return
    setResult(null)
    start(async () => {
      const t = Date.now()
      try {
        const res = await fetch('/api/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        })
        const body = await res.json() as { data?: { filters?: IntakeFilters; rawText?: string; ollamaError?: string; _meta?: OllamaMeta } }
        const data = body.data
        setResult({
          filters: data?.filters ?? {},
          rawText: data?.rawText ?? '',
          ollamaError: data?.ollamaError ?? '',
          ...(data?._meta !== undefined ? { meta: data._meta } : {}),
          raw: body,
          durationMs: Date.now() - t,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        })
      } catch (e) {
        setResult({ filters: {}, rawText: '', ollamaError: '', raw: null, durationMs: Date.now() - t, error: String(e) })
      }
    })
  }

  const filterEntries = result ? Object.entries(result.filters) : []

  return (
    <div style={panelGrid}>
      {/* Left: input */}
      <div>
        <p style={colHead}>Description</p>
        <SampleButtons
          labels={INTAKE_SAMPLES.map(s => s.label)}
          fieldLabel="description"
          onSelect={fill}
          onRandom={fillRandom}
          disabled={pending}
        />
        <textarea
          ref={ref}
          rows={5}
          defaultValue={INTAKE_SAMPLES[0]?.text ?? ''}
          disabled={pending}
          aria-label="Test description"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '0.5rem 0.625rem',
            border: '1px solid var(--clr-border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--clr-bg)', color: 'var(--clr-text)',
            fontFamily: 'var(--font)', fontSize: '0.875rem', lineHeight: 1.5, resize: 'vertical',
          }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          style={{ marginTop: '0.5rem' }}
          disabled={pending}
          onClick={run}
        >
          {pending ? 'Running…' : 'Run test'}
        </button>
      </div>

      {/* Right: results */}
      <div>
        <p style={colHead}>Results</p>
        <div role="status" aria-live="polite" aria-atomic="false">
          {!result && !pending && (
            <p className={styles.muted} style={{ fontSize: '0.875rem' }}>Results will appear here.</p>
          )}
          {result?.error && <p className={styles.errorMsg}>{result.error}</p>}
          {result && (
            <>
              {result.ollamaError ? (
                <OllamaErrorMsg error={result.ollamaError} model={result.meta?.model} />
              ) : filterEntries.length === 0 ? (
                <p className={styles.muted} style={{ fontSize: '0.875rem' }}>
                  {result.rawText
                    ? 'No filters extracted — model responded but returned no recognisable JSON.'
                    : 'No response from Ollama — check it is running and the model is pulled.'}
                </p>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead><tr><th>Filter</th><th>Value</th></tr></thead>
                    <tbody>
                      {filterEntries.map(([k, v]) => (
                        <tr key={k}>
                          <td><code>{k}</code></td>
                          <td>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <MetaTable meta={result.meta} durationMs={result.durationMs} />
              <RawResponse data={result.raw} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
