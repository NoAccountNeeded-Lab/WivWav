'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { routing } from '../../routing'
import styles from './LanguageSwitcher.module.css'

// Human-readable display names for each supported locale.
// These intentionally stay in each language's native script — they are never
// asterisked in the ZZ test locale because a user must be able to read them.
const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  zz: '***',
}

export function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('SiteHeader')
  // Use next/navigation's usePathname for the raw URL (includes locale prefix like /en/discover).
  // next-intl's usePathname internally depends on useLocale() to strip the prefix, which can lag
  // during a locale transition and return the old locale, causing doubled prefixes like /es/es.
  const rawPathname = usePathname()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = e.target.value
    // Strip the current locale prefix from the raw path to build the new URL.
    const localePrefix = '/' + locale
    const pathWithoutLocale = rawPathname.startsWith(localePrefix)
      ? rawPathname.slice(localePrefix.length) || '/'
      : rawPathname
    // Hard navigation ensures the server re-renders with the new locale's messages.
    // Soft navigation (router.replace) can serve stale RSC cache and skip re-fetching
    // getTranslations, leaving the page in the old language despite the URL changing.
    window.location.href = '/' + nextLocale + (pathWithoutLocale === '/' ? '' : pathWithoutLocale)
  }

  // Only render when more than one locale is configured (future-proofing).
  if (routing.locales.length <= 1) return null

  return (
    <div className={styles.wrap}>
      <label htmlFor="language-switcher" className={styles.label}>
        {t('languageSwitcherLabel')}
      </label>
      <select
        id="language-switcher"
        className={styles.select}
        value={locale}
        onChange={handleChange}
        aria-label={t('languageSwitcherLabel')}
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {LOCALE_LABELS[loc] ?? loc.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  )
}
