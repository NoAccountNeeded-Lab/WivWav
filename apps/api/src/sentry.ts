/**
 * Sentry initialisation for the Fastify API.
 *
 * Import this module at the very top of `index.ts` — before any other imports
 * — so that unhandled exceptions thrown during startup are captured.
 *
 * PII scrubbing strips VINs, user IPs, and dealer contact fields from every
 * event before it is transmitted to sentry.io.
 */
import * as Sentry from '@sentry/node'
import { scrubPii, scrubSentryEvent } from './sentry-pii.js'

Sentry.init({
  dsn: process.env['SENTRY_DSN'],

  environment: process.env['NODE_ENV'] ?? 'development',

  tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,

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

export { Sentry }
