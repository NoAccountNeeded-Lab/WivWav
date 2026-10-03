import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessagesForLocale } from '../../messages'

export type TestLocale = 'en' | 'es'

/** Wraps `children` in the real message catalog for `locale`. */
export function IntlTestProvider({
  locale = 'en',
  children,
}: {
  locale?: TestLocale
  children: ReactNode
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={getMessagesForLocale(locale)}>
      {children}
    </NextIntlClientProvider>
  )
}

/** Testing Library `render` with the real catalog for `locale` (default English). */
export function renderWithIntl(ui: ReactElement, locale: TestLocale = 'en'): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <IntlTestProvider locale={locale}>{children}</IntlTestProvider>,
  })
}
