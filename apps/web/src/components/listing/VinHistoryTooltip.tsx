import type { Translate } from '@/lib/intl'
import type { ChartDatum } from './vinHistory'
import { valueLabel } from './vinHistory'

interface TooltipPayload {
  name?: string
  value?: number
  dataKey?: string
  payload?: ChartDatum
}

interface VinHistoryTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  locale: string
  t: Translate
}

interface VisibleTooltipPayload extends TooltipPayload {
  value: number
}

export function VinHistoryTooltip({ active, payload, locale, t }: VinHistoryTooltipProps) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((entry): entry is VisibleTooltipPayload => typeof entry.value === 'number')
  if (visible.length === 0) return null

  const point = visible[0]?.payload
  return (
    <div
      style={{
        background: 'var(--color-surface, #fff)',
        border: '1px solid var(--color-border, #e2e8f0)',
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
      }}
    >
      <div style={{ color: 'var(--color-text-secondary, #64748b)' }}>
        {point?.label} · {point?.listingLabel}
      </div>
      {visible.map((entry, index) => (
        <div key={`${entry.dataKey ?? 'series'}-${index}`} style={{ fontWeight: 600, color: 'var(--color-text, #0f172a)' }}>
          {entry.name}: {valueLabel(entry.dataKey, entry.value, locale, t)}
        </div>
      ))}
    </div>
  )
}
