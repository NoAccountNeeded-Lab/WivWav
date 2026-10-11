import type { CSSProperties } from 'react'
import styles from '../ops.module.css'

export interface OllamaMeta {
  provider: string
  model: string
  baseUrl?: string
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className={styles.muted} style={{ width: '8rem', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>{label}</td>
      <td style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem' }}><code style={{ fontSize: '0.8125rem' }}>{value}</code></td>
    </tr>
  )
}

export function MetaTable({ meta, durationMs }: { meta: OllamaMeta | undefined; durationMs: number | null }) {
  if (!meta && durationMs === null) return null
  return (
    <table className={styles.table} style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}>
      <tbody>
        {meta && <>
          <MetaRow label="Provider" value={meta.provider} />
          <MetaRow label="Model" value={meta.model} />
          {meta.baseUrl && <MetaRow label="Base URL" value={meta.baseUrl} />}
        </>}
        {durationMs !== null && <MetaRow label="Duration" value={`${durationMs.toLocaleString()} ms`} />}
      </tbody>
    </table>
  )
}

export function OllamaErrorMsg({ error, model }: { error: string; model: string | undefined }) {
  const isNotFound = error.toLowerCase().includes('not found') || error.toLowerCase().includes('pull')
  const isConnRefused =
    error === 'fetch failed' ||
    error.toLowerCase().includes('econnrefused') ||
    error.toLowerCase().includes('connect')
  return (
    <div style={{
      padding: '0.625rem 0.75rem',
      background: 'var(--clr-surface)',
      border: '1px solid var(--clr-border-strong)',
      borderLeft: '3px solid var(--clr-danger, #c0392b)',
      borderRadius: 'var(--radius-sm)',
      fontSize: '0.8125rem',
      lineHeight: 1.5,
    }}>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--clr-text)' }}>
        {isConnRefused ? 'Ollama is not running' : isNotFound ? 'Model not found' : 'Ollama error'}
      </p>
      {!isConnRefused && <p style={{ margin: '0.25rem 0 0', color: 'var(--clr-text-muted)' }}>{error}</p>}
      {isConnRefused && (
        <p style={{ margin: '0.25rem 0 0', color: 'var(--clr-text-muted)' }}>
          Start it in your terminal:{' '}
          <code style={{ userSelect: 'all', background: 'var(--clr-bg)', padding: '0.125rem 0.375rem', borderRadius: '3px' }}>
            ollama serve
          </code>
          {' '}— or open the Ollama app.
        </p>
      )}
      {isNotFound && model && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--clr-text-muted)' }}>
          Pull it first:{' '}
          <code style={{ userSelect: 'all', background: 'var(--clr-bg)', padding: '0.125rem 0.375rem', borderRadius: '3px' }}>
            ollama pull {model}
          </code>
        </p>
      )}
    </div>
  )
}

export function RawResponse({ data }: { data: unknown }) {
  return (
    <details style={{ marginTop: '0.75rem' }}>
      <summary style={{ fontSize: '0.75rem', color: 'var(--clr-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
        Raw response
      </summary>
      <pre className={styles.miniCode} style={{ marginTop: '0.375rem', maxHeight: '12rem' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}

const sampleBtnStyle: CSSProperties = {
  padding: '0.375rem 0.5rem',
  fontSize: '0.75rem',
  border: '1px solid var(--clr-border-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--clr-surface)',
  color: 'var(--clr-text)',
  cursor: 'pointer',
  lineHeight: 1.4,
  fontFamily: 'var(--font)',
}

export function SampleButtons({
  labels,
  fieldLabel,
  onSelect,
  onRandom,
  disabled,
}: {
  labels: string[]
  fieldLabel: string
  onSelect: (i: number) => void
  onRandom: () => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          style={sampleBtnStyle}
          disabled={disabled}
          aria-label={`Fill ${fieldLabel}: ${label}`}
          onClick={() => onSelect(i)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        style={{ ...sampleBtnStyle, borderStyle: 'dashed' }}
        disabled={disabled}
        aria-label={`Fill ${fieldLabel} with random sample`}
        onClick={onRandom}
      >
        Random
      </button>
    </div>
  )
}

export const panelGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 3fr',
  gap: '1.5rem',
  padding: '1.25rem 1.5rem',
}

export const colHead: CSSProperties = {
  margin: '0 0 0.625rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: 'var(--clr-text-muted)',
}
