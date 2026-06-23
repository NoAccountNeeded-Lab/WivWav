'use client'

import { useEffect, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import styles from './ThemePicker.module.css'

interface ThemeMeta {
  id: string
  name: string
  bg: string
  surface: string
  accent: string
  text: string
}

const THEMES: ThemeMeta[] = [
  { id: 'terminal',   name: 'Terminal',    bg: '#050d17', surface: '#081525', accent: '#00d4ff', text: '#c4dff0' },
  { id: 'grafana',    name: 'Grafana',     bg: '#111217', surface: '#181b1f', accent: '#5794f2', text: '#d9d9d9' },
  { id: 'midnight',   name: 'Midnight',    bg: '#0a0a0a', surface: '#111111', accent: '#818cf8', text: '#f0f0f0' },
  { id: 'nord',       name: 'Nord',        bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0', text: '#eceff4' },
  { id: 'dracula',    name: 'Dracula',     bg: '#282a36', surface: '#21222c', accent: '#bd93f9', text: '#f8f8f2' },
  { id: 'catppuccin', name: 'Catppuccin',  bg: '#1e1e2e', surface: '#181825', accent: '#cba6f7', text: '#cdd6f4' },
  { id: 'tokyo',      name: 'Tokyo Night', bg: '#1a1b26', surface: '#16161e', accent: '#7aa2f7', text: '#a9b1d6' },
  { id: 'rose',       name: 'Rose Pinê',  bg: '#191724', surface: '#1f1d2e', accent: '#c4a7e7', text: '#e0def4' },
  { id: 'hacker',     name: 'Hacker',      bg: '#0d0d0d', surface: '#111111', accent: '#00ff41', text: '#00ff41' },
  { id: 'classic',    name: 'Classic',     bg: '#f8fafc', surface: '#ffffff', accent: '#1d4ed8', text: '#0f172a' },
]

const STORAGE_KEY = 'ops-theme'
const DEFAULT = 'terminal'

export function ThemePicker() {
  const [current, setCurrent] = useState(DEFAULT)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) ?? DEFAULT
    setCurrent(stored)
    document.documentElement.dataset.theme = stored
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function apply(id: string) {
    setCurrent(id)
    document.documentElement.dataset.theme = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  const activeMeta = THEMES.find(t => t.id === current)

  return (
    <div className={styles.root} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Choose theme"
      >
        <Palette size={14} />
        <span>{activeMeta?.name ?? 'Theme'}</span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Theme picker">
          <p className={styles.popoverTitle}>Theme</p>
          <div className={styles.grid}>
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={styles.card}
                data-active={current === t.id}
                onClick={() => { apply(t.id); setOpen(false) }}
                title={t.name}
              >
                {/* Mini preview */}
                <span
                  className={styles.preview}
                  style={{ background: t.bg, borderColor: t.surface }}
                >
                  <span className={styles.previewBar} style={{ background: t.surface }} />
                  <span className={styles.previewContent}>
                    <span className={styles.previewDot} style={{ background: t.accent }} />
                    <span className={styles.previewLine} style={{ background: t.text, opacity: 0.5 }} />
                    <span className={styles.previewLine} style={{ background: t.text, opacity: 0.25 }} />
                  </span>
                </span>
                <span className={styles.cardName}>{t.name}</span>
                {current === t.id && <span className={styles.activeCheck} aria-label="active">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
