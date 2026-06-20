'use client'

import type { CategoricalRendererProps } from './types'
import styles from './ChipsRenderer.module.css'

export function ChipsRenderer({ items, onToggle }: CategoricalRendererProps) {
  return (
    <div className={styles.chips} role="list">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="listitem"
          className={`${styles.chip} ${item.active ? styles.active : ''}`}
          disabled={item.disabled}
          aria-pressed={item.active}
          onClick={() => onToggle(item.value)}
        >
          {item.label}
          <span className={styles.count}>{item.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  )
}
