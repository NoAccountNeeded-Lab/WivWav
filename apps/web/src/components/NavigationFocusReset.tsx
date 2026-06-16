'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function NavigationFocusReset() {
  const pathname = usePathname()
  useEffect(() => {
    document.getElementById('focus-reset')?.focus()
  }, [pathname])
  return null
}
