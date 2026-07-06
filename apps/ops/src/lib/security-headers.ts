/**
 * Security headers applied to every response from the ops app.
 *
 * Bull Board and admin views render behind the operator session (#450 D9-style
 * requirement), so ops responses carry a same-origin-only CSP, a frame-ancestors
 * lockdown (nothing may embed this app in an iframe), and MIME-sniffing
 * protection. Exported as plain data so both `next.config.ts` (via
 * `getSecurityHeadersConfig`) and tests can consume the same source of truth.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-inline' on script-src is a known tradeoff, not an oversight:
      // Next.js's App Router hydration payload ships as an inline <script>
      // (no nonce plumbing wired up yet), so removing this would break every
      // page. Tightening to a per-request nonce is a good follow-up but is a
      // bigger change than this issue's scope (fail-closed admin boundary +
      // session auth) — track separately if this needs to harden further.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
]

/** Shape expected by `NextConfig.headers()`. */
export function getSecurityHeadersConfig(): Array<{
  source: string
  headers: Array<{ key: string; value: string }>
}> {
  return [
    {
      source: '/(.*)',
      headers: [...SECURITY_HEADERS],
    },
  ]
}
