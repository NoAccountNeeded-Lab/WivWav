/**
 * Sentry edge runtime configuration.
 *
 * Used by Next.js middleware and any route segments that opt into the edge
 * runtime. The edge runtime has a restricted API surface so this config is
 * intentionally minimal — no Node.js built-ins, no `dns` lookups.
 *
 * PII scrubbing mirrors the other Sentry configs.
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
