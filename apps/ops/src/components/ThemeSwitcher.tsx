'use client'

import { useEffect, useState } from 'react'
import styles from './ThemeSwitcher.module.css'

const THEMES = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'grafana', label: 'Grafana' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'classic', label: 'Classic' },
]

const STORAGE_KEY = 'ops-theme'
const DEFAULT = 'terminal'

export function ThemeSwitcher() {
  const [current, setCurrent] = useState(DEFAULT)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) ?? DEFAULT
    setCurrent(stored)
    document.documentElement.dataset.theme = stored
  }, [])

  function apply(id: string) {
    setCurrent(id)
    document.documentElement.dataset.theme = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  return (
    <div className={styles.switcher} role="group" aria-label="Choose theme">
      {THEMES.map(t => (
        <button
          key={t.id}
          type="button"
          className={styles.pill}
          data-active={current === t.id}
          onClick={() => apply(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
