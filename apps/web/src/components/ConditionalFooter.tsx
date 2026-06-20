'use client'

import { usePathname } from 'next/navigation'
import { Footer } from './Footer'

const NO_FOOTER_PREFIXES = ['/listings/']

export function ConditionalFooter() {
  const pathname = usePathname()
  if (NO_FOOTER_PREFIXES.some((p) => pathname.startsWith(p))) return null
  return <Footer />
}
