'use client'

import { useRef, useState, useTransition } from 'react'
import styles from '../ops.module.css'
import { MetaTable, OllamaErrorMsg, RawResponse, SampleButtons, colHead, panelGrid, type OllamaMeta } from './jobTestShared'

const REMAP_SAMPLES = [
  {
    label: 'Honda Odyssey',
    sourceName: 'BraunAbility Dealer',
    selectors: JSON.stringify([
      { targetField: 'title',   selector: '.listing-title',  attribute: null, transform: null },
      { targetField: 'price',   selector: '.listing-price',  attribute: null, transform: 'parsePrice' },
      { targetField: 'year',    selector: '.specs .year',    attribute: null, transform: 'parseInt' },
      { targetField: 'make',    selector: '.specs .make',    attribute: null, transform: null },
      { targetField: 'model',   selector: '.specs .model',   attribute: null, transform: null },
      { targetField: 'mileage', selector: '.specs .mileage', attribute: null, transform: 'parseFloat' },
      { targetField: 'vin',     selector: '.specs .vin',     attribute: null, transform: null },
    ], null, 2),
    html: `<article class="inventory-item">
  <h2 class="vehicle-name">2020 Honda Odyssey Conversion Van</h2>
  <div class="vehicle-cost">$38,500</div>
  <div class="vehicle-specs">
    <span class="spec-year">2020</span>
    <span class="spec-make">Honda</span>
    <span class="spec-model">Odyssey</span>
    <span class="spec-miles">41,000 mi</span>
    <span class="spec-vin">5FNRL6H74LB012345</span>
  </div>
  <p class="conversion-info">Side Entry, Fold-Out Ramp, Hand Controls</p>
</article>`,
  },
  {
    label: 'Toyota Sienna (redesign)',
    sourceName: 'VMI Mobility',
    selectors: JSON.stringify([
      { targetField: 'title',   selector: 'h1.vehicle-title', attribute: null, transform: null },
      { targetField: 'price',   selector: '.price',           attribute: null, transform: 'parsePrice' },
      { targetField: 'mileage', selector: '.miles',           attribute: null, transform: 'parseFloat' },
      { targetField: 'vin',     selector: '.vin-number',      attribute: null, transform: null },
      { targetField: 'rampType', selector: '.ramp-type',      attribute: null, transform: null },
    ], null, 2),
    html: `<div class="listing-wrapper" data-stock="VMI-1042">
  <header class="listing-header">
    <h2 class="listing-name">2023 Toyota Sienna Platinum WAV</h2>
    <span class="sale-price">$74,900</span>
  </header>
  <ul class="detail-list">
    <li data-field="odometer">22,100 miles</li>
    <li data-field="vin-id">JTDZDREV5NJ012345</li>
    <li data-field="conversion">BraunAbility In-Floor Ramp</li>
    <li data-field="entry">Rear Entry</li>
  </ul>
</div>`,
  },
  {
    label: 'Chrysler Pacifica (new dealer)',
    sourceName: 'Mobility Works',
    selectors: JSON.stringify([
      { targetField: 'title',        selector: '.car-name',       attribute: null, transform: null },
      { targetField: 'price',        selector: '#asking-price',   attribute: null, transform: 'parsePrice' },
      { targetField: 'year',         selector: '.year-value',     attribute: null, transform: 'parseInt' },
      { targetField: 'conversionType', selector: '.entry-type',   attribute: null, transform: null },
    ], null, 2),
    html: `<div class="vehicle-page">
  <h1 class="veh-title">2022 Chrysler Pacifica Touring Accessible</h1>
  <div class="pricing-section">
    <p class="msrp">MSRP: <strong>$68,495</strong></p>
  </div>
  <table class="specs-grid">
    <tr><th>Year</th><td class="spec-val">2022</td></tr>
    <tr><th>Entry</th><td class="spec-val">Side Entry</td></tr>
    <tr><th>Ramp</th><td class="spec-val">PowerFold Ramp</td></tr>
    <tr><th>VIN</th><td class="spec-val">2C4RC1GG2NR543210</td></tr>
  </table>
</div>`,
  },
]

interface RemapFieldMapping {
  targetField: string
  selector: string
  attribute: string | null
  transform: string | null
}

export function RemapTestPanel() {
  const htmlRef = useRef<HTMLTextAreaElement>(null)
  const selectorsRef = useRef<HTMLTextAreaElement>(null)
  const sourceRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{
    mappings: RemapFieldMapping[]
    confidence: number
    notes: string
    rawText: string
    ollamaError: string
    meta?: OllamaMeta
    raw: unknown
    durationMs: number
    error?: string
  } | null>(null)

  function fill(i: number) {
    const s = REMAP_SAMPLES[i]
    if (!s) return
    if (sourceRef.current)    sourceRef.current.value    = s.sourceName
    if (selectorsRef.current) selectorsRef.current.value = s.selectors
    if (htmlRef.current)      htmlRef.current.value      = s.html
  }
  function fillRandom() {
    fill(Math.floor(Math.random() * REMAP_SAMPLES.length))
  }

  function run() {
    const html = htmlRef.current?.value.trim() ?? ''
    if (!html) return
    let previousMappings: unknown = []
    try { previousMappings = JSON.parse(selectorsRef.current?.value ?? '[]') } catch { /* ignore */ }
    const sourceName = sourceRef.current?.value.trim() || 'Test Source'
    setResult(null)
    start(async () => {
      const t = Date.now()
      try {
        const res = await fetch('/api/ai-test/remap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, previousMappings, sourceName }),
        })
        const body = await res.json() as {
          data?: {
            mappings?: RemapFieldMapping[]
            confidence?: number
            notes?: string
            rawText?: string
            ollamaError?: string
            _meta?: OllamaMeta
          }
        }
        const data = body.data
        setResult({
          mappings: data?.mappings ?? [],
          confidence: data?.confidence ?? 0,
          notes: data?.notes ?? '',
          rawText: data?.rawText ?? '',
          ollamaError: data?.ollamaError ?? '',
          ...(data?._meta !== undefined ? { meta: data._meta } : {}),
          raw: body,
          durationMs: Date.now() - t,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        })
      } catch (e) {
        setResult({ mappings: [], confidence: 0, notes: '', rawText: '', ollamaError: '', raw: null, durationMs: Date.now() - t, error: String(e) })
      }
    })
  }

  const confidencePct = result ? Math.round(result.confidence * 100) : 0
  const confidenceVariant = confidencePct >= 80 ? 'success' : confidencePct >= 50 ? 'warning' : 'danger'

  return (
    <div style={{ ...panelGrid, gridTemplateColumns: '1fr 1fr' }}>
      {/* Left: inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div>
          <p style={colHead}>Sample data</p>
          <SampleButtons
            labels={REMAP_SAMPLES.map(s => s.label)}
            fieldLabel="sample"
            onSelect={fill}
            onRandom={fillRandom}
            disabled={pending}
          />
        </div>
        <div>
          <p style={{ ...colHead, marginBottom: '0.375rem' }}>Source name</p>
          <input
            ref={sourceRef}
            type="text"
            className={styles.input}
            defaultValue={REMAP_SAMPLES[0]?.sourceName ?? ''}
            disabled={pending}
            style={{ width: '100%', boxSizing: 'border-box' }}
            aria-label="Source name"
          />
        </div>
        <div>
          <p style={{ ...colHead, marginBottom: '0.375rem' }}>Previous selectors (JSON array)</p>
          <textarea
            ref={selectorsRef}
            rows={8}
            defaultValue={REMAP_SAMPLES[0]?.selectors ?? ''}
            disabled={pending}
            aria-label="Previous selectors JSON"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--clr-border-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--clr-bg)', color: 'var(--clr-text)',
              fontFamily: 'var(--font, monospace)', fontSize: '0.75rem', lineHeight: 1.45, resize: 'vertical',
            }}
          />
        </div>
        <div>
          <p style={{ ...colHead, marginBottom: '0.375rem' }}>Updated HTML</p>
          <textarea
            ref={htmlRef}
            rows={8}
            defaultValue={REMAP_SAMPLES[0]?.html ?? ''}
            disabled={pending}
            aria-label="Updated HTML"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--clr-border-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--clr-bg)', color: 'var(--clr-text)',
              fontFamily: 'var(--font, monospace)', fontSize: '0.75rem', lineHeight: 1.45, resize: 'vertical',
            }}
          />
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={pending}
          onClick={run}
        >
          {pending ? 'Remapping…' : 'Run test'}
        </button>
      </div>

      {/* Right: results */}
      <div>
        <p style={colHead}>Proposed selectors</p>
        <div role="status" aria-live="polite" aria-atomic="false">
          {!result && !pending && (
            <p className={styles.muted} style={{ fontSize: '0.875rem' }}>Results will appear here.</p>
          )}
          {result?.error && <p className={styles.errorMsg}>{result.error}</p>}
          {result && (
            <>
              {result.ollamaError ? (
                <OllamaErrorMsg error={result.ollamaError} model={result.meta?.model} />
              ) : result.mappings.length === 0 ? (
                <p className={styles.muted} style={{ fontSize: '0.875rem' }}>
                  {result.rawText
                    ? 'No mappings returned — model responded but returned no recognisable JSON.'
                    : 'No response from Ollama — check it is running and the model is pulled.'}
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.625rem' }}>
                    <span className={styles.muted} style={{ fontSize: '0.8125rem' }}>Confidence</span>
                    <span className={styles.badge} data-variant={confidenceVariant}>{confidencePct}%</span>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Field</th><th>Selector</th><th>Attr</th><th>Transform</th></tr>
                      </thead>
                      <tbody>
                        {result.mappings.map((m, i) => (
                          <tr key={i}>
                            <td><code>{m.targetField}</code></td>
                            <td><code style={{ fontSize: '0.75rem' }}>{m.selector}</code></td>
                            <td className={styles.muted}>{m.attribute ?? '—'}</td>
                            <td className={styles.muted}>{m.transform ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {result.notes && (
                    <p style={{ marginTop: '0.625rem', fontSize: '0.8125rem', color: 'var(--clr-text-muted)' }}>
                      <strong>Notes:</strong> {result.notes}
                    </p>
                  )}
                </>
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
