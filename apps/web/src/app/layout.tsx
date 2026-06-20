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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Expose the public API base URL to client components via a data attribute
  // so the browser-side error reporter can POST to /admin/client-events without
  // needing next/headers or build-time environment variables in client code.
  const apiBaseUrl = getPublicApiBaseUrl()

  return (
    <html lang="en" className={`${font.variable} ${logoFont.variable}`}>
      <body data-api-url={apiBaseUrl}>
        <NavigationFocusReset />
        <GlobalErrorHandlers />
        <FetchErrorMonitor />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ErrorBoundary>
          <main id="main-content" className="site-main">
            {children}
          </main>
          <ConditionalFooter />
        </ErrorBoundary>
      </body>
    </html>
  )
}
