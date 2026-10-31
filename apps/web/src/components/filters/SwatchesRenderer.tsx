'use client'

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CategoricalRendererProps } from './types'
import { FacetTooltip } from './FacetTooltip'
import styles from './SwatchesRenderer.module.css'

// ── Color map ──────────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  white:     '#f5f5f5',
  black:     '#1a1a1a',
  silver:    '#c0c0c0',
  gray:      '#808080',
  grey:      '#808080',
  red:       '#dc2626',
  blue:      '#2563eb',
  navy:      '#1e3a8a',
  green:     '#16a34a',
  yellow:    '#ca8a04',
  orange:    '#ea580c',
  brown:     '#92400e',
  tan:       '#d4a574',
  beige:     '#e8d5b7',
  gold:      '#b45309',
  maroon:    '#7f1d1d',
  purple:    '#7c3aed',
  pink:      '#db2777',
  teal:      '#0d9488',
  bronze:    '#a16207',
  champagne: '#f0dca0',
  charcoal:  '#374151',
  cream:     '#fef3c7',
  copper:    '#b45309',
}

function swatchColor(value: string): string {
  return COLOR_MAP[value.toLowerCase()] ?? '#d1d5db'
}

function needsBorder(value: string): boolean {
  const v = value.toLowerCase()
  return v === 'white' || v === 'cream' || v === 'champagne' || v === 'beige'
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SwatchesRenderer({ items, onToggle }: CategoricalRendererProps) {
  const t = useTranslations('FilterControls')
  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <FacetTooltip key={item.value} text={`${item.label}: ${t('listingCount', { count: item.count })}`}>
          <button
            type="button"
            className={`${styles.swatch} ${item.active ? styles.active : ''}`}
            disabled={item.disabled}
            aria-pressed={item.active}
            aria-label={`${item.label}: ${t('listingCount', { count: item.count })}`}
            onClick={() => onToggle(item.value)}
          >
            {/* Fixed-size dot slot: the selection ring is inset, so nothing grows or crowds the label. */}
            <span className={styles.dotSlot} aria-hidden="true">
              <span
                className={styles.dot}
                style={{
                  background: swatchColor(item.value),
                  boxShadow: needsBorder(item.value) ? 'inset 0 0 0 1px rgba(0,0,0,0.15)' : undefined,
                }}
              />
            </span>
            <span className={styles.label}>{item.label}</span>
            <span className={styles.check} aria-hidden="true">{item.active && <Check size={14} strokeWidth={3} />}</span>
            {item.count > 0 && (
              <span className={styles.count}>{item.count.toLocaleString()}</span>
            )}
          </button>
        </FacetTooltip>
      ))}
    </div>
  )
}
