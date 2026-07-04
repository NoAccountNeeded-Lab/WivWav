'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import styles from './ThemePicker.module.css'

/* ── Theme families ─────────────────────────────────────────────────────────
   Each family has a dark variant (id) and a light variant (lightId).
   "classic" has no dark variant — it is always the light option.
────────────────────────────────────────────────────────────────────────────── */
interface ThemeFamily {
  id: string        // dark variant theme id
  lightId: string   // light variant theme id
  name: string
  darkBg: string
  darkSurface: string
  darkAccent: string
  darkText: string
  lightBg: string
  lightSurface: string
  lightAccent: string
  lightText: string
}

const THEME_FAMILIES: ThemeFamily[] = [
  {
    id: 'terminal', lightId: 'terminal-light', name: 'Terminal',
    darkBg: '#050d17', darkSurface: '#081525', darkAccent: '#00d4ff', darkText: '#c4dff0',
    lightBg: '#f0f7fb', lightSurface: '#ffffff', lightAccent: '#0088b0', lightText: '#0a2233',
  },
  {
    id: 'grafana', lightId: 'grafana-light', name: 'Grafana',
    darkBg: '#111217', darkSurface: '#181b1f', darkAccent: '#5794f2', darkText: '#d9d9d9',
    lightBg: '#f4f5f5', lightSurface: '#ffffff', lightAccent: '#3274d9', lightText: '#1b1c1e',
  },
  {
    id: 'midnight', lightId: 'midnight-light', name: 'Midnight',
    darkBg: '#0a0a0a', darkSurface: '#111111', darkAccent: '#818cf8', darkText: '#f0f0f0',
    lightBg: '#f5f5ff', lightSurface: '#ffffff', lightAccent: '#4f55d9', lightText: '#12122a',
  },
  {
    id: 'nord', lightId: 'nord-light', name: 'Nord',
    darkBg: '#2e3440', darkSurface: '#3b4252', darkAccent: '#88c0d0', darkText: '#eceff4',
    lightBg: '#eceff4', lightSurface: '#e5e9f0', lightAccent: '#5e81ac', lightText: '#2e3440',
  },
  {
    id: 'dracula', lightId: 'dracula-light', name: 'Dracula',
    darkBg: '#282a36', darkSurface: '#21222c', darkAccent: '#bd93f9', darkText: '#f8f8f2',
    lightBg: '#f8f8ff', lightSurface: '#ffffff', lightAccent: '#7c4fc4', lightText: '#282a36',
  },
  {
    id: 'catppuccin', lightId: 'catppuccin-light', name: 'Catppuccin',
    darkBg: '#1e1e2e', darkSurface: '#181825', darkAccent: '#cba6f7', darkText: '#cdd6f4',
    lightBg: '#eff1f5', lightSurface: '#e6e9ef', lightAccent: '#8839ef', lightText: '#4c4f69',
  },
  {
    id: 'tokyo', lightId: 'tokyo-light', name: 'Tokyo Night',
    darkBg: '#1a1b26', darkSurface: '#16161e', darkAccent: '#7aa2f7', darkText: '#a9b1d6',
    lightBg: '#d5d6db', lightSurface: '#cbccd1', lightAccent: '#2959aa', lightText: '#343b58',
  },
  {
    id: 'rose', lightId: 'rose-light', name: 'Rose Pinê',
    darkBg: '#191724', darkSurface: '#1f1d2e', darkAccent: '#c4a7e7', darkText: '#e0def4',
    lightBg: '#faf4ed', lightSurface: '#fffaf3', lightAccent: '#907aa9', lightText: '#575279',
  },
  {
    id: 'hacker', lightId: 'hacker-light', name: 'Hacker',
    darkBg: '#0d0d0d', darkSurface: '#111111', darkAccent: '#00ff41', darkText: '#00ff41',
    lightBg: '#f0f5f0', lightSurface: '#e8f0e8', lightAccent: '#006600', lightText: '#003300',
  },
  {
    id: 'matrix', lightId: 'matrix-light', name: 'Matrix',
    darkBg: '#000000', darkSurface: '#050e05', darkAccent: '#00ff41', darkText: '#00ff41',
    lightBg: '#f0fff0', lightSurface: '#e8ffe8', lightAccent: '#008020', lightText: '#003300',
  },
  {
    id: 'classic-dark', lightId: 'classic', name: 'Classic',
    darkBg: '#0d1117', darkSurface: '#161b22', darkAccent: '#388bfd', darkText: '#e6edf3',
    lightBg: '#f8fafc', lightSurface: '#ffffff', lightAccent: '#1d4ed8', lightText: '#0f172a',
  },
]

const VALID_MODES = ['light', 'dark', 'system'] as const
type Mode = (typeof VALID_MODES)[number]

const THEME_KEY = 'ops-theme'
const MODE_KEY  = 'ops-mode'

const DEFAULT_DARK_FAMILY  = 'terminal'
const DEFAULT_LIGHT_FAMILY = 'classic-dark'

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function readOsDark(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function validateMode(raw: string | null): Mode {
  if (raw !== null && (VALID_MODES as readonly string[]).includes(raw)) {
    return raw as Mode
  }
  return 'system'
}

/**
 * Resolve the concrete theme id to apply given current family id and mode.
 * Family id is always the dark variant id (e.g. "nord").
 * osDark is passed explicitly so the function is pure and testable.
 */
function resolveTheme(familyId: string, mode: Mode, osDark: boolean): string {
  const family = THEME_FAMILIES.find(f => f.id === familyId || f.lightId === familyId)
  if (!family) return familyId

  if (mode === 'system') {
    return osDark ? family.id : family.lightId
  }
  return mode === 'light' ? family.lightId : family.id
}

/**
 * Given an active theme id (may be a light variant), find the family dark id.
 */
function toFamilyId(themeId: string): string {
  const family = THEME_FAMILIES.find(f => f.id === themeId || f.lightId === themeId)
  return family ? family.id : themeId
}

/**
 * Sync the <meta name="theme-color"> tag to the resolved theme's background,
 * so the Safari/mobile browser chrome matches the page (mirrors the
 * data-theme attribute this always accompanies).
 */
function applyThemeColor(themeId: string) {
  const family = THEME_FAMILIES.find(f => f.id === themeId || f.lightId === themeId)
  if (!family) return
  const color = family.id === themeId ? family.darkBg : family.lightBg

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = color
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function ThemePicker() {
  // familyId is always the dark-variant id (e.g. "nord"), not the active applied id
  const [familyId, setFamilyId] = useState(DEFAULT_DARK_FAMILY)
  const [mode, setMode]         = useState<Mode>('system')
  // osDark tracks the current OS preference as state so previews stay in sync
  const [osDark, setOsDark]     = useState(true)
  const [open, setOpen]         = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Read stored preferences and apply on mount
  useEffect(() => {
    const currentOsDark = readOsDark()
    setOsDark(currentOsDark)

    const storedTheme = localStorage.getItem(THEME_KEY)
    const storedMode  = validateMode(localStorage.getItem(MODE_KEY))

    let initFamilyId: string
    if (storedTheme) {
      initFamilyId = toFamilyId(storedTheme)
    } else {
      // First visit: pick a sensible default based on OS preference
      initFamilyId = currentOsDark ? DEFAULT_DARK_FAMILY : DEFAULT_LIGHT_FAMILY
    }

    setFamilyId(initFamilyId)
    setMode(storedMode)

    const resolved = resolveTheme(initFamilyId, storedMode, currentOsDark)
    document.documentElement.dataset.theme = resolved
    applyThemeColor(resolved)
    // Persist the chosen theme so reloads are consistent
    localStorage.setItem(THEME_KEY, resolved)
  }, [])

  // Subscribe to OS light/dark change
  useEffect(() => {
    function handleChange(e: MediaQueryListEvent) {
      const newOsDark = e.matches
      setOsDark(newOsDark)
      // Re-apply theme immediately (using latest familyId and mode via closure over setters)
      setFamilyId(prev => {
        setMode(prevMode => {
          if (prevMode === 'system') {
            const resolved = resolveTheme(prev, 'system', newOsDark)
            document.documentElement.dataset.theme = resolved
            applyThemeColor(resolved)
            localStorage.setItem(THEME_KEY, resolved)
          }
          return prevMode
        })
        return prev
      })
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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

  const applyMode = useCallback((newMode: Mode) => {
    setMode(newMode)
    localStorage.setItem(MODE_KEY, newMode)
    setFamilyId(prev => {
      const currentOsDark = readOsDark()
      const resolved = resolveTheme(prev, newMode, currentOsDark)
      document.documentElement.dataset.theme = resolved
      applyThemeColor(resolved)
      localStorage.setItem(THEME_KEY, resolved)
      return prev
    })
  }, [])

  const applyFamily = useCallback((newFamilyId: string) => {
    setFamilyId(newFamilyId)
    setMode(prevMode => {
      const currentOsDark = readOsDark()
      const resolved = resolveTheme(newFamilyId, prevMode, currentOsDark)
      document.documentElement.dataset.theme = resolved
      applyThemeColor(resolved)
      localStorage.setItem(THEME_KEY, resolved)
      return prevMode
    })
    setOpen(false)
  }, [])

  const activeFamilyMatch = THEME_FAMILIES.find(f => f.id === familyId)
  const activeFamily: ThemeFamily = activeFamilyMatch ?? (THEME_FAMILIES[0] as ThemeFamily)
  const isDark = mode === 'dark' || (mode === 'system' && osDark)

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
        <Palette size={14} aria-hidden="true" />
        <span>{activeFamily.name}</span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Theme picker">

          {/* ── Mode row ──────────────────────────────────────────────── */}
          <div className={styles.modeRow} role="group" aria-label="Colour mode">
            <button
              type="button"
              className={styles.modeBtn}
              data-active={mode === 'light'}
              onClick={() => applyMode('light')}
              aria-pressed={mode === 'light'}
            >
              <Sun size={13} aria-hidden="true" />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              data-active={mode === 'dark'}
              onClick={() => applyMode('dark')}
              aria-pressed={mode === 'dark'}
            >
              <Moon size={13} aria-hidden="true" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              data-active={mode === 'system'}
              onClick={() => applyMode('system')}
              aria-pressed={mode === 'system'}
            >
              <Monitor size={13} aria-hidden="true" />
              <span>System</span>
            </button>
          </div>

          {/* ── Theme label ───────────────────────────────────────────── */}
          <p className={styles.popoverTitle}>Theme</p>

          {/* ── Theme grid ────────────────────────────────────────────── */}
          <div className={styles.grid}>
            {THEME_FAMILIES.map(family => {
              const isActive = family.id === familyId
              const previewBg      = isDark ? family.darkBg      : family.lightBg
              const previewSurface = isDark ? family.darkSurface : family.lightSurface
              const previewAccent  = isDark ? family.darkAccent  : family.lightAccent
              const previewText    = isDark ? family.darkText    : family.lightText

              return (
                <button
                  key={family.id}
                  type="button"
                  className={styles.card}
                  data-active={isActive}
                  onClick={() => applyFamily(family.id)}
                  title={family.name}
                >
                  {/* Mini preview shows current mode's palette */}
                  <span
                    className={styles.preview}
                    style={{ background: previewBg, borderColor: previewSurface }}
                  >
                    <span className={styles.previewBar} style={{ background: previewSurface }} />
                    <span className={styles.previewContent}>
                      <span className={styles.previewDot} style={{ background: previewAccent }} />
                      <span className={styles.previewLine} style={{ background: previewText, opacity: 0.5 }} />
                      <span className={styles.previewLine} style={{ background: previewText, opacity: 0.25 }} />
                    </span>
                  </span>
                  <span className={styles.cardName}>{family.name}</span>
                  {isActive && <span className={styles.activeCheck} aria-label="active">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
