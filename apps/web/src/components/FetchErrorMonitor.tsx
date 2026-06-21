'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/error-reporter'

/**
 * Patches `window.fetch` to intercept 4xx/5xx responses from the API and
 * forward them to the ops log collector.
 *
 * Tracked origins:
 * - Relative paths (always same-origin)
 * - Absolute URLs on the same host+port as the current page
 * - Absolute URLs on the configured API host (`data-api-url` on `<body>`)
 *
 * All other cross-origin requests (CDN assets, Meilisearch, etc.) are skipped
 * to avoid noise.
 *
 * Renders nothing — this component exists only for its side-effects.
 * Place it in the root layout alongside GlobalErrorHandlers.
 */
export function FetchErrorMonitor(): null {
  useEffect(() => {
    const originalFetch = window.fetch

    // Resolve the API host from the data attribute set in layout.tsx so that
    // cross-origin API calls (e.g. localhost:3003 vs web on localhost:3000) are
    // tracked even when the API runs on a different port in development.
    const apiBaseUrl = document.body.dataset['apiUrl'] ?? ''
    const apiHost = (() => {
      try {
        return new URL(apiBaseUrl).host
      } catch {
        return null
      }
    })()

    const patchedFetch = async function(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const response = await originalFetch(input, init)

      if (response.status >= 400) {
        const rawUrl = input instanceof Request ? input.url : String(input)

        // Derive a safe path (strip origin and query string)
        let path: string
        try {
          path = new URL(rawUrl, window.location.origin).pathname
        } catch {
          path = rawUrl
        }

        // Skip the error-reporter endpoint unconditionally to prevent recursive loops.
        // This guard fires before the origin check and protects against recursion in
        // both cross-origin API deployments and same-origin proxy deployments (where
        // isTracked would be true but we must never report on the reporting endpoint itself).
        if (path === '/admin/client-events') return response

        // Track same-origin requests and requests to the configured API host.
        // Use host (hostname+port) not just hostname so that localhost:3003 and
        // localhost:3000 are treated as distinct origins for CDN/Meilisearch exclusion,
        // while still allowing the explicit API host through.
        const isTracked =
          rawUrl.startsWith('/') ||
          (() => {
            try {
              const requestHost = new URL(rawUrl).host
              return (
                requestHost === window.location.host ||
                (apiHost !== null && requestHost === apiHost)
              )
            } catch {
              return false
            }
          })()

        if (isTracked) {
          const method =
            (init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET').toUpperCase()

          reportError({
            type: 'fetch-error',
            message: `${method} ${path} → ${response.status}`,
            method,
            path,
            status: response.status,
            url: window.location.href,
          })
        }
      }

      return response
    }

    window.fetch = patchedFetch

    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch
    }
  }, [])

  return null
}
