'use client'

import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, ReactNode } from 'react'
import styles from './FacetTooltip.module.css'

const HOVER_DELAY_MS = 150

/** True for keyboard-driven focus; assumes true where :focus-visible is unsupported. */
export function focusVisible(event: FocusEvent): boolean {
  try {
    return (event.target as Element).matches(':focus-visible')
  } catch {
    return true
  }
}

interface FacetTooltipProps {
  /** Visual duplicate of the trigger's accessible name and count; hidden from assistive technology. */
  text: string
  children: ReactNode
}

/**
 * Styled replacement for native `title` tooltips: ~150 ms hover delay, immediate on keyboard focus
 * (:focus-visible only, so a mouse or touch click does not leave a stuck tip), dismissed with Escape.
 * The tip repeats the trigger's accessible name, so it is aria-hidden rather than described-by.
 */
export function FacetTooltip({ text, children }: FacetTooltipProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])

  const show = () => { clear(); setOpen(true) }
  const hide = () => { clear(); setOpen(false) }

  return (
    <span
      role="presentation"
      className={styles.wrap}
      onMouseEnter={() => { clear(); timer.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS) }}
      onMouseLeave={hide}
      onFocusCapture={(event) => { if (focusVisible(event)) show() }}
      onBlurCapture={hide}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); hide() } }}
    >
      {children}
      {open && <span aria-hidden="true" data-tooltip="" className={styles.tip}>{text}</span>}
    </span>
  )
}
