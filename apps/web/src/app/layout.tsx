import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Raleway } from 'next/font/google'
import { headers } from 'next/headers'
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
import { ConditionalSkipLink } from '@/components/ConditionalSkipLink'
import { Footer } from '@/components/Footer'
import { NavigationFocusReset } from '@/components/NavigationFocusReset'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { getTranslations } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { routing } from '../../routing'
import { getMessagesForLocale } from '../../messages'

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

async function getRequestLocale() {
  const locale = (await headers()).get('X-NEXT-INTL-LOCALE')
  return locale && routing.locales.includes(locale as (typeof routing.locales)[number])
    ? locale
    : routing.defaultLocale
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Expose the public API base URL to client components via a data attribute
  // so the browser-side error reporter can POST to /telemetry/client-events without
  // needing next/headers or build-time environment variables in client code.
  const apiBaseUrl = getPublicApiBaseUrl()

  // next-intl's middleware only sets locale context for [locale]-prefixed routes.
  // Routes outside [locale] (e.g. /discover) have no intl context, so this reads
  // the locale next-intl's middleware still stamps on the request headers and
  // loads messages directly from the bundled JSON rather than relying on
  // next-intl/server's getLocale()/getMessages(), which require that context.
  const locale = await getRequestLocale()
  const t = await getTranslations({ locale, namespace: 'Common' })
  const messages = getMessagesForLocale(locale)

  return (
    <html lang={locale} className={`${font.variable} ${logoFont.variable}`}>
      <body data-api-url={apiBaseUrl}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NavigationFocusReset />
          <GlobalErrorHandlers />
          <FetchErrorMonitor />
          <ConditionalSkipLink label={t('skipToMainContent')} hideLocalePaths />
          <ErrorBoundary>
            <main id="main-content" className="site-main">
              {children}
            </main>
            <ConditionalFooter footer={<Footer locale={locale} />} hideLocalePaths />
          </ErrorBoundary>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
