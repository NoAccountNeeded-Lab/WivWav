const DEFAULT_PUBLIC_API_URL = 'http://localhost:4001'

export function getServerApiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_URL
}

/**
 * Base URL for server-rendered code (Server Components, route handlers) that
 * needs the value the browser should use. Safe to call `NEXT_PUBLIC_*` here
 * because this only ever runs server-side, at request time, in the container
 * — Next.js only inlines `NEXT_PUBLIC_*` into code that ends up in the
 * client JS bundle, and this function is never imported from a `'use
 * client'` module. See #837.
 */
export function getPublicApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_URL
}

/**
 * Base URL for browser-side `fetch` calls in `'use client'` components.
 *
 * Never reads `process.env.NEXT_PUBLIC_API_URL` directly — in a client
 * component that value is inlined into the JS bundle at `next build` time,
 * so a single shared production image can never carry a deploy-specific
 * value that way (see #837). Instead this reads the `data-api-url`
 * attribute `RootLayout` (`app/layout.tsx`) stamps on `<body>` from
 * `getPublicApiBaseUrl()` above — computed server-side on every request, so
 * it always reflects the container's actual runtime environment.
 *
 * Falls back to `DEFAULT_PUBLIC_API_URL` when `document` doesn't exist yet
 * (server-rendered pass of a `'use client'` component, before hydration) or
 * the attribute is empty; the effect that performs the real fetch only ever
 * runs in the browser, after hydration, once the attribute is present.
 */
export function getClientApiBaseUrl(): string {
  if (typeof document === 'undefined') return DEFAULT_PUBLIC_API_URL
  return document.body.dataset['apiUrl'] || DEFAULT_PUBLIC_API_URL
}
