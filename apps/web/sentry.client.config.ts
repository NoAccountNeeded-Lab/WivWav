/**
 * Sentry client-side configuration.
 *
 * Disabled by default. Set NEXT_PUBLIC_SENTRY_ENABLED=true and
 * NEXT_PUBLIC_SENTRY_DSN to opt in.
 *
 * This file is auto-loaded by @sentry/nextjs when the instrumentation hook
 * is registered. It runs only in the browser.
 *
 * PII scrubbing rules are applied in `beforeSend` — VINs, IPs, and dealer
 * contact fields are stripped before any event leaves the browser.
 */
import * as Sentry from '@sentry/nextjs'
import { scrubPii, scrubSentryEvent } from '@wivwav/observability'

if (process.env['NEXT_PUBLIC_SENTRY_ENABLED'] === 'true' && process.env['NEXT_PUBLIC_SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

    // Capture 10 % of transactions in production to avoid quota burn.
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

    // Session Replay is disabled unless we make an explicit product decision to use it.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    environment: process.env['NODE_ENV'] ?? 'development',

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = scrubPii(breadcrumb.message)
      }

      const data = breadcrumb.data
      const url = data?.['url']
      if (data && typeof url === 'string') {
        data['url'] = scrubPii(url)
      }

      return breadcrumb
    },

    beforeSend(event) {
      return scrubSentryEvent(event)
    },
  })
}
