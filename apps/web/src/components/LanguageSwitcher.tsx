'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { routing } from '../../routing'
import styles from './LanguageSwitcher.module.css'

// Human-readable display names for each supported locale.
const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
}

export function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('SiteHeader')
  const router = useRouter()
  const pathname = usePathname()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = e.target.value
    // Replace the locale segment in the current pathname.
    // pathname looks like "/en/filters" — swap the first segment.
    const segments = pathname.split('/')
    segments[1] = nextLocale
    router.push(segments.join('/'))
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
