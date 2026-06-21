import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Raleway } from 'next/font/google'
import './globals.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const font = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
})

const logoFont = Raleway({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-logo',
  display: 'swap',
})
import { GlobalErrorHandlers } from '@/components/GlobalErrorHandlers'
import { FetchErrorMonitor } from '@/components/FetchErrorMonitor'
import { ConditionalFooter } from '@/components/ConditionalFooter'
import { NavigationFocusReset } from '@/components/NavigationFocusReset'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'WivWav — Find Wheelchair Accessible Vehicles',
  description:
    'Search thousands of wheelchair accessible vehicles from dealers and private sellers across the US. Filter by conversion type, lift, ramp, hand controls, and more.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#5c35c6',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Expose the public API base URL to client components via a data attribute
  // so the browser-side error reporter can POST to /admin/client-events without
  // needing next/headers or build-time environment variables in client code.
  const apiBaseUrl = getPublicApiBaseUrl()

  // next-intl sets locale via middleware for locale-prefixed routes.
  // Routes outside [locale] (e.g. /ops, /discover) have no intl context,
  // so fall back to 'en' and load English messages so hooks like useLocale()
  // and useTranslations() work in components like SiteHeader/LanguageSwitcher.
  const locale = await getLocale().catch(() => 'en')
  const messages = await getMessages({ locale }).catch(() => ({}))

  return (
    <html lang={locale} className={`${font.variable} ${logoFont.variable}`}>
      <body data-api-url={apiBaseUrl}>
        <NavigationFocusReset />
        <GlobalErrorHandlers />
        <FetchErrorMonitor />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ErrorBoundary>
            <main id="main-content" className="site-main">
              {children}
            </main>
            <ConditionalFooter />
          </ErrorBoundary>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
