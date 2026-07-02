'use client'

import { usePathname } from 'next/navigation'
import { Footer } from './Footer'

const VEHICLE_DETAIL_PATH = /^(?:\/[a-z]{2})?\/vehicle\//

export function ConditionalFooter() {
  const pathname = usePathname()
  if (VEHICLE_DETAIL_PATH.test(pathname)) return null
  return <Footer />
}
