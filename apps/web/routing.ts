import { defineRouting } from 'next-intl/routing'

const allLocales = ['en', 'es', 'zz'] as const
// Use an explicit env var rather than NODE_ENV so the filter works reliably
// in both the Node.js server runtime and the Edge Runtime (middleware).
// Set NEXT_PUBLIC_ENABLE_ZZ_LOCALE=true in .env.local for local dev.
const locales = allLocales.filter(
  (l) => l !== 'zz' || process.env.NEXT_PUBLIC_ENABLE_ZZ_LOCALE === 'true',
) as unknown as typeof allLocales

export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
})
