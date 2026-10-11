'use client'

import { useRef, useState, useTransition } from 'react'
import styles from '../ops.module.css'
import { MetaTable, OllamaErrorMsg, RawResponse, SampleButtons, colHead, panelGrid, type OllamaMeta } from './jobTestShared'

const STRUCTURE_SAMPLES = [
  {
    label: 'Sienna (ul/li)',
    html: `<div class="vehicle-listing">
  <h1 class="listing-title">2022 Toyota Sienna Wheelchair Van</h1>
  <span class="listing-price">$52,995</span>
  <ul class="specs">
    <li><strong>Year:</strong> 2022</li>
    <li><strong>Make:</strong> Toyota</li>
    <li><strong>Model:</strong> Sienna</li>
    <li><strong>Mileage:</strong> 14,200 miles</li>
    <li><strong>VIN:</strong> 5TDKZ3DC2NS123456</li>
    <li><strong>Conversion:</strong> Rear Entry, In-Floor Ramp</li>
    <li><strong>Condition:</strong> Used</li>
  </ul>
  <img class="vehicle-image" src="/images/sienna.jpg" alt="Sienna WAV" />
</div>`,
  },
  {
    label: 'Pacifica (dl/dd)',
    html: `<section id="listing-detail">
  <h2 class="title">2021 Chrysler Pacifica Touring Accessible Van</h2>
  <p class="asking-price">$61,500</p>
  <dl class="vehicle-details">
    <dt>Year</dt><dd>2021</dd>
    <dt>Make</dt><dd>Chrysler</dd>
    <dt>Model</dt><dd>Pacifica</dd>
    <dt>Trim</dt><dd>Touring</dd>
    <dt>Stock #</dt><dd>WV-00412</dd>
    <dt>VIN</dt><dd>2C4RC1BG1MR512345</dd>
    <dt>Mileage</dt><dd>8,900 miles</dd>
    <dt>Entry Type</dt><dd>Side Entry</dd>
    <dt>Ramp</dt><dd>Fold-Out Power Ramp</dd>
    <dt>Condition</dt><dd>New</dd>
  </dl>
  <p class="location">Orlando, FL 32801</p>
</section>`,
  },
  {
    label: 'Grand Caravan (table)',
    html: `<div class="inventory-card" data-vin="2D4RN5D18AR123456">
  <h3>2019 Dodge Grand Caravan Mobility Van</h3>
  <div class="price-block">$29,888</div>
  <table class="spec-table">
    <tr><th>Year</th><td>2019</td></tr>
    <tr><th>Make</th><td>Dodge</td></tr>
    <tr><th>Model</th><td>Grand Caravan</td></tr>
    <tr><th>Miles</th><td>52,400</td></tr>
    <tr><th>Stock</th><td>GC-0219</td></tr>
    <tr><th>Conversion</th><td>BraunAbility Rear Entry</td></tr>
    <tr><th>Floor</th><td>Lowered 14"</td></tr>
    <tr><th>Hand Controls</th><td>Yes</td></tr>
    <tr><th>Condition</th><td>Used</td></tr>
  </table>
</div>`,
  },
]

interface StructureField {
  name: string
  selector: string
  sample: string | null
}

export function StructureTestPanel() {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{
    fields: StructureField[]
    rawText: string
    ollamaError: string
    meta?: OllamaMeta
    raw: unknown
    durationMs: number
    error?: string
  } | null>(null)

  function fill(i: number) {
    const s = STRUCTURE_SAMPLES[i]
    if (ref.current && s) ref.current.value = s.html
  }
  function fillRandom() {
    fill(Math.floor(Math.random() * STRUCTURE_SAMPLES.length))
  }

  function run() {
    const html = ref.current?.value.trim() ?? ''
    if (!html) return
    setResult(null)
    start(async () => {
      const t = Date.now()
      try {
        const res = await fetch('/api/ai-test/structure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html }),
        })
        const body = await res.json() as {
          data?: { fields?: StructureField[]; rawText?: string; ollamaError?: string; _meta?: OllamaMeta }
        }
        const data = body.data
        setResult({
          fields: data?.fields ?? [],
          rawText: data?.rawText ?? '',
          ollamaError: data?.ollamaError ?? '',
          ...(data?._meta !== undefined ? { meta: data._meta } : {}),
          raw: body,
          durationMs: Date.now() - t,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        })
      } catch (e) {
        setResult({ fields: [], rawText: '', ollamaError: '', raw: null, durationMs: Date.now() - t, error: String(e) })
      }
    })
  }

  return (
    <div style={panelGrid}>
      {/* Left: input */}
      <div>
        <p style={colHead}>HTML snippet</p>
        <SampleButtons
          labels={STRUCTURE_SAMPLES.map(s => s.label)}
          fieldLabel="HTML snippet"
          onSelect={fill}
          onRandom={fillRandom}
          disabled={pending}
        />
        <textarea
          ref={ref}
          rows={12}
          defaultValue={STRUCTURE_SAMPLES[0]?.html ?? ''}
          disabled={pending}
          aria-label="HTML to analyze"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '0.5rem 0.625rem',
            border: '1px solid var(--clr-border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--clr-bg)', color: 'var(--clr-text)',
            fontFamily: 'var(--font, monospace)', fontSize: '0.8125rem', lineHeight: 1.45, resize: 'vertical',
          }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          style={{ marginTop: '0.5rem' }}
          disabled={pending}
          onClick={run}
        >
          {pending ? 'Analyzing…' : 'Run test'}
        </button>
      </div>

      {/* Right: results */}
      <div>
        <p style={colHead}>Detected fields</p>
        <div role="status" aria-live="polite" aria-atomic="false">
          {!result && !pending && (
            <p className={styles.muted} style={{ fontSize: '0.875rem' }}>Results will appear here.</p>
          )}
          {result?.error && <p className={styles.errorMsg}>{result.error}</p>}
          {result && (
            <>
              {result.ollamaError ? (
                <OllamaErrorMsg error={result.ollamaError} model={result.meta?.model} />
              ) : result.fields.length === 0 ? (
                <p className={styles.muted} style={{ fontSize: '0.875rem' }}>
                  {result.rawText
                    ? 'No fields detected — model responded but returned no recognisable JSON.'
                    : 'No response from Ollama — check it is running and the model is pulled.'}
                </p>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead><tr><th>Field</th><th>Selector</th><th>Sample</th></tr></thead>
                    <tbody>
                      {result.fields.map((f, i) => (
                        <tr key={i}>
                          <td><code>{f.name}</code></td>
                          <td><code style={{ fontSize: '0.75rem' }}>{f.selector}</code></td>
                          <td className={styles.muted}>{f.sample ?? '—'}</td>
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
