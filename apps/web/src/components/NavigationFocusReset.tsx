'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function NavigationFocusReset() {
  const pathname = usePathname()
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('#main-content h1')
    if (!h1) return
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
    h1.focus({ preventScroll: true })
  }, [pathname])
  return null
}
