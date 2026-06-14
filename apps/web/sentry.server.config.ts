/**
 * Sentry server-side configuration (Node.js runtime).
 *
 * Runs in Next.js API routes and server components that execute on the
 * Node.js runtime. Loaded via the instrumentation hook.
 *
 * PII scrubbing mirrors the client config — VINs, IPs, and dealer contact
 * data are removed before any event is sent to sentry.io.
 */
import * as Sentry from '@sentry/nextjs'
import { scrubPii, scrubSentryEvent } from './sentry-pii'

Sentry.init({
  dsn: process.env['SENTRY_DSN'],

  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

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
