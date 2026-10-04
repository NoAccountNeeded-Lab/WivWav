import { AlertCircle, AlertTriangle } from 'lucide-react'
import type { AttentionSeverity } from '@wivwav/types'

/** Severity is always icon + word, never colour alone. */
export function SeverityMark({ severity }: { severity: AttentionSeverity }) {
  const critical = severity === 'critical'
  const Icon = critical ? AlertCircle : AlertTriangle
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: critical ? 'var(--clr-danger-text)' : 'var(--clr-warning-text)' }}>
      <Icon size={16} aria-hidden="true" />
      {critical ? 'Critical' : 'Warning'}
    </span>
  )
}
