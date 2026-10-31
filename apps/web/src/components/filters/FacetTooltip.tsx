'use client'

import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import styles from './FacetTooltip.module.css'

const HOVER_DELAY_MS = 150

interface FacetTooltipProps {
  /** Supplementary text only; the trigger must already carry its essential name and count. */
  text: string
  /** One focusable element; receives aria-describedby while the tooltip is shown. */
  children: ReactElement<{ 'aria-describedby'?: string }>
}

/**
 * Styled replacement for native `title` tooltips: ~150 ms hover delay, immediate on keyboard focus,
 * dismissed with Escape. Touch taps focus the trigger, which shows the tooltip until blur.
 */
export function FacetTooltip({ text, children }: FacetTooltipProps) {
  const id = useId()
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
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); hide() } }}
    >
      {cloneElement(children, open ? { 'aria-describedby': id } : {})}
      {open && <span id={id} role="tooltip" className={styles.tip}>{text}</span>}
    </span>
  )
}
