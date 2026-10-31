'use client'

import { Check } from 'lucide-react'
import type { CategoricalRendererProps } from './types'
import { FacetTooltip } from './FacetTooltip'
import styles from './BarsRenderer.module.css'

export function BarsRenderer({ items, onToggle, maxCount }: CategoricalRendererProps) {
  return (
    <ul className={styles.list} role="list">
      {items.map((item) => {
        const pct = item.count > 0
          ? Math.max(4, Math.round((item.count / maxCount) * 100))
          : 4
        return (
          <li key={item.value}>
            <FacetTooltip text={`${item.label}: ${item.count.toLocaleString()}`}>
              <button
                type="button"
                className={styles.bar}
                aria-pressed={item.active}
                disabled={item.disabled}
                onClick={() => onToggle(item.value)}
              >
                <span
                  className={styles.fill}
                  style={{ width: `${pct}%` }}
                  data-active={item.active}
                  aria-hidden="true"
                />
                {/* Reserved slot: the checkmark never changes the row's layout. */}
                <span className={styles.check} aria-hidden="true">
                  {item.active && <Check size={14} strokeWidth={3} />}
                </span>
                <span className={styles.label}>{item.label}</span>
                <span className={styles.count}>
                  {item.count > 0 ? item.count.toLocaleString() : '—'}
                </span>
              </button>
            </FacetTooltip>
          </li>
        )
      })}
    </ul>
  )
}
