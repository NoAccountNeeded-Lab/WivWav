/**
 * Sentry initialisation for the scraper worker.
 *
 * Disabled by default. Set SENTRY_ENABLED=true and SENTRY_DSN to opt in.
 *
 * When enabled, import this module at the very top of `index.ts` — before any
 * other imports — so that unhandled exceptions thrown during startup and BullMQ
 * job failures are captured from the very beginning.
 *
 * The scraper is a long-running background worker. Sentry captures:
 *  - Unhandled promise rejections (process-level)
 *  - Job-level errors re-thrown from BullMQ processor functions
 *
 * PII scrubbing strips VINs and dealer contact fields from every event before
 * it is transmitted to sentry.io. User IPs are never present in scraper events
 * (it runs server-side), but the rule is included for defence-in-depth.
 */
import * as Sentry from '@sentry/node'
import { scrubPii, scrubSentryEvent } from '@wivwav/observability'

export const isSentryEnabled = process.env['SENTRY_ENABLED'] === 'true' && Boolean(process.env['SENTRY_DSN'])

if (isSentryEnabled) {
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
}

export { Sentry }
