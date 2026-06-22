'use client'

import { usePathname } from 'next/navigation'
import { routing } from '../../routing'

interface ConditionalSkipLinkProps {
  label: string
  hideLocalePaths?: boolean
}

function stripLocalePrefix(pathname: string) {
  const localePattern = new RegExp(`^/(${routing.locales.join('|')})(?=/|$)`)
  return pathname.replace(localePattern, '') || '/'
}

export function ConditionalSkipLink({ label, hideLocalePaths = false }: ConditionalSkipLinkProps) {
  const pathname = usePathname()
  const pathnameWithoutLocale = stripLocalePrefix(pathname)

  if (hideLocalePaths && pathnameWithoutLocale !== pathname) return null

  return (
    <a href="#main-content" className="skip-link">
      {label}
    </a>
  )
}
