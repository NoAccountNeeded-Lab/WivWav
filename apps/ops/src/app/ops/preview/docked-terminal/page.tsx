import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { DockedTerminalClient } from './DockedTerminalClient'

export const metadata: Metadata = {
  title: opsPageTitle('Docked terminal preview'),
}

/**
 * Dev/operator-only comparison route (#913) — the "docked terminal"
 * candidate Overview treatment, evaluated against #912's dashboard-grid
 * candidate and the current `/ops`. Same 404-outside-development gate as
 * `/workspace-preview` and `/inspector-preview`: not registered in
 * `OPS_NAV_GROUPS`, so it's unreachable from nav and 404s in production.
 * Nested under `apps/ops/src/app/ops/` (unlike those two top-level dev
 * harnesses) so it inherits the real `OpsShell`/`OpsNav` chrome from
 * `ops/layout.tsx` — this route is meant to look like a real production
 * page, not a bare harness.
 */
export default function DockedTerminalPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <Suspense fallback={null}>
      <DockedTerminalClient apiBaseUrl={getPublicApiBaseUrl()} />
    </Suspense>
  )
}
