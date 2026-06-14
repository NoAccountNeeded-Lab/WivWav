/**
 * Sentry client-side configuration.
 *
 * This file is auto-loaded by @sentry/nextjs when the instrumentation hook
 * is registered. It runs only in the browser.
 *
 * PII scrubbing rules are applied in `beforeSend` — VINs, IPs, and dealer
 * contact fields are stripped before any event leaves the browser.
 */
import * as Sentry from '@sentry/nextjs'
import { scrubPii, scrubSentryEvent } from './sentry-pii'

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],

  // Capture 10 % of transactions in production to avoid quota burn
  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

  // Replay 1 % of sessions in production; 100 % when an error occurs
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],

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
