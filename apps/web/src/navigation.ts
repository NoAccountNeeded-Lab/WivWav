import { createNavigation } from 'next-intl/navigation'
import { routing } from '../routing'

// Locale-aware navigation helpers — use these instead of next/link and
// next/navigation in locale-scoped routes so that links automatically include
// the current locale prefix (e.g. /en/vehicle/123).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
