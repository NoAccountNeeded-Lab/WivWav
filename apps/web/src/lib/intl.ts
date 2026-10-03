import type { useTranslations } from 'next-intl'

/** A next-intl translator for any namespace, so pure helpers can take one as a parameter. */
export type Translate = ReturnType<typeof useTranslations>

/**
 * Maps an app locale (`en`, `es`, `zz`) to the BCP 47 tag used for number,
 * currency, and date formatting. WivWav lists US vehicles, so Spanish uses the
 * US variant (comma thousands separators, US date conventions).
 */
export function toIntlLocale(locale: string): string {
  return locale === 'es' ? 'es-US' : 'en-US'
}
