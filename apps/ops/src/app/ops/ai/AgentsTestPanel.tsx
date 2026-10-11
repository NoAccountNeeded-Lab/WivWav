'use client'

import { useRef, useState, useTransition } from 'react'
import styles from '../ops.module.css'
import { MetaTable, OllamaErrorMsg, SampleButtons, colHead, panelGrid, type OllamaMeta } from './jobTestShared'

const AGENTS_SAMPLES = [
  {
    label: 'New filter',
    text: 'Add a new filter for wheelchair capacity (number of wheelchairs the vehicle can carry) to the listings search page.',
  },
  {
    label: 'Saved searches',
    text: 'Add a saved search feature so users can bookmark a set of filters and get an email notification when new matching listings are added.',
  },
  {
    label: 'Dealer contact form',
    text: 'Add a "Contact dealer" form to each listing page that captures the user\'s name, email, and a message, then emails the relevant dealer and stores the inquiry in the database.',
  },
  {
    label: 'Price history chart',
    text: 'Add a price history chart to the listing detail page showing how the asking price has changed over time, pulling data from a new price_history table.',
  },
]

export function AgentsTestPanel() {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{
    response: string
    ollamaError: string
    meta?: OllamaMeta
    durationMs: number
    error?: string
  } | null>(null)

  function fill(i: number) {
    const s = AGENTS_SAMPLES[i]
    if (ref.current && s) ref.current.value = s.text
  }
  function fillRandom() {
    fill(Math.floor(Math.random() * AGENTS_SAMPLES.length))
  }

  function run() {
    const task = ref.current?.value.trim() ?? ''
    if (!task) return
    setResult(null)
    start(async () => {
      const t = Date.now()
      try {
        const res = await fetch('/api/ai-test/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
        })
        const body = await res.json() as { data?: { response?: string; ollamaError?: string; _meta?: OllamaMeta } }
        const data = body.data
        setResult({
          response: data?.response ?? '',
          ollamaError: data?.ollamaError ?? '',
          ...(data?._meta !== undefined ? { meta: data._meta } : {}),
          durationMs: Date.now() - t,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        })
      } catch (e) {
        setResult({ response: '', ollamaError: '', durationMs: Date.now() - t, error: String(e) })
      }
    })
  }

  return (
    <div style={panelGrid}>
      {/* Left: input */}
      <div>
        <p style={colHead}>Task description</p>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: 'var(--clr-text-muted)' }}>
          Describe a feature or change for WivWav. The planner agent will respond with an
          implementation plan — a good smoke test for the agents model.
        </p>
        <SampleButtons
          labels={AGENTS_SAMPLES.map(s => s.label)}
          fieldLabel="task description"
          onSelect={fill}
          onRandom={fillRandom}
          disabled={pending}
        />
        <textarea
          ref={ref}
          rows={6}
          defaultValue={AGENTS_SAMPLES[0]?.text ?? ''}
          disabled={pending}
          aria-label="Task description"
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
          {pending ? 'Planning…' : 'Run test'}
        </button>
      </div>

      {/* Right: results */}
      <div>
        <p style={colHead}>Planner response</p>
        <div role="status" aria-live="polite" aria-atomic="false">
        {!result && !pending && (
          <p className={styles.muted} style={{ fontSize: '0.875rem' }}>Results will appear here.</p>
        )}
        {result?.error && <p className={styles.errorMsg}>{result.error}</p>}
        {result && (
          <>
            {result.ollamaError ? (
              <OllamaErrorMsg error={result.ollamaError} model={result.meta?.model} />
            ) : result.response ? (
              <pre style={{
                margin: 0,
                padding: '0.75rem',
                border: '1px solid var(--clr-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--clr-surface)',
                fontSize: '0.8125rem',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '24rem',
                overflowY: 'auto',
              }}>
                {result.response}
              </pre>
            ) : (
              <p className={styles.muted} style={{ fontSize: '0.875rem' }}>
                No response from Ollama — check it is running and the model is pulled.
              </p>
            )}
            <MetaTable meta={result.meta} durationMs={result.durationMs} />
          </>
        )}
        </div>
      </div>
    </div>
  )
}
