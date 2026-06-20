// ── Categorical filter types ──────────────────────────────────────────────────

export interface FilterItem {
  value: string
  label: string
  count: number
  active: boolean
  disabled: boolean
}

export interface CategoricalRendererProps {
  items: FilterItem[]
  onToggle: (value: string) => void
  maxCount: number
}

export type CategoricalRendererType = 'bars' | 'chips' | 'donut' | 'swatches'

// ── Range filter types ────────────────────────────────────────────────────────

export type RangeRendererType = 'histogram'

// ── Shared helpers ────────────────────────────────────────────────────────────

export function formatFilterLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
