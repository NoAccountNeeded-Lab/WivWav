'use client'

import type { CategoricalRendererProps } from './types'
import styles from './BarsRenderer.module.css'

export function BarsRenderer({
  items,
  onToggle,
  maxCount,
  countSide = 'right',
}: CategoricalRendererProps & { countSide?: 'left' | 'right' }) {
  return (
    <ul className={styles.list} role="list">
      {items.map((item) => {
        const pct = item.count > 0
          ? Math.max(4, Math.round((item.count / maxCount) * 100))
          : 4
        const count = (
          <span className={countSide === 'left' ? `${styles.count} ${styles.countLeft}` : styles.count}>
            {item.count > 0 ? item.count.toLocaleString() : '—'}
          </span>
        )
        return (
          <li key={item.value}>
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
              {countSide === 'left' && count}
              <span className={styles.label}>{item.label}</span>
              {countSide === 'right' && count}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function BarsCountLeftRenderer(props: CategoricalRendererProps) {
  return <BarsRenderer {...props} countSide="left" />
}
