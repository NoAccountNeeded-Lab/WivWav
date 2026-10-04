import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Info } from 'lucide-react'
import { OpsStatusChip, type OpsStatusVariant } from '@/components/OpsStatusChip'
import { RelativeTimestamp } from '@/lib/relative-time'
import { freshnessLabel, type Freshness } from './helm-freshness'
import styles from './helm-sections.module.css'

const FRESHNESS_VARIANT: Record<Freshness, OpsStatusVariant> = {
  loading: 'muted',
  fresh: 'success',
  stale: 'warning',
  unavailable: 'danger',
}

/** Per-resource freshness: always icon + text, so stale/unavailable is never colour-only. */
export function FreshnessChip({ freshness, label }: { freshness: Freshness; label?: string }) {
  return <OpsStatusChip variant={FRESHNESS_VARIANT[freshness]} label={label ? `${label}: ${freshnessLabel(freshness)}` : freshnessLabel(freshness)} />
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'danger' ? AlertTriangle : tone === 'warning' ? CircleHelp : Info
  return (
    <p className={styles.notice} data-tone={tone}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

export function SuccessText({ children }: { children: ReactNode }) {
  return (
    <span className={styles.rowTitle}>
      <CheckCircle2 size={16} aria-hidden="true" />
      {children}
    </span>
  )
}

export function Timestamp({ value, label }: { value: string | Date | null; label: string }) {
  return (
    <span>
      {label} <RelativeTimestamp value={value} fallback="never" />
    </span>
  )
}
