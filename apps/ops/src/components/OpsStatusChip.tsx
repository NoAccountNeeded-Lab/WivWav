import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, HelpCircle, PauseCircle } from 'lucide-react'
import styles from './OpsStatusChip.module.css'

export type OpsStatusVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'paused' | 'muted'

interface OpsStatusChipProps {
  label: string
  variant: OpsStatusVariant
  icon?: ReactNode
}

export function OpsStatusChip({ label, variant, icon }: OpsStatusChipProps) {
  return (
    <span className={styles.chip} data-variant={variant}>
      {icon ?? defaultIcon(variant)}
      <span>{label}</span>
    </span>
  )
}

function defaultIcon(variant: OpsStatusVariant) {
  if (variant === 'success') return <CheckCircle2 size={14} aria-hidden="true" />
  if (variant === 'warning') return <AlertTriangle size={14} aria-hidden="true" />
  if (variant === 'danger') return <AlertCircle size={14} aria-hidden="true" />
  if (variant === 'paused') return <PauseCircle size={14} aria-hidden="true" />
  if (variant === 'muted') return <HelpCircle size={14} aria-hidden="true" />
  return <Clock3 size={14} aria-hidden="true" />
}
