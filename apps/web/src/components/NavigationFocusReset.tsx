'use client'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function NavigationFocusReset() {
  const pathname = usePathname()
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    const h1 = document.querySelector<HTMLElement>('#main-content h1')
    if (!h1) return
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
    h1.focus({ preventScroll: true })
  }, [pathname])
  return null
}
