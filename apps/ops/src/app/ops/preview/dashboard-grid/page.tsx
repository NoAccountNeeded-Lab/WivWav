import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { DashboardGridClient } from './DashboardGridClient'

export const metadata: Metadata = {
  title: opsPageTitle('Dashboard grid (preview)'),
}

/**
 * Dev-only comparison route (#912): renders the existing Overview data as a
 * grid of independent, resizable/collapsible/closable widget panels, so it
 * can be reviewed side by side with the current `/ops` Overview and the
 * docked-terminal candidate (`/ops/preview/workspace`... see #913) before
 * either replaces `OpsOverviewClient`. Same 404-outside-development pattern
 * as `workspace-preview` (#854) and `inspector-preview` (#733): not
 * registered in `OPS_NAV_GROUPS`, and never reachable in production.
 *
 * Nested under `/ops` (unlike `workspace-preview`/`inspector-preview`, which
 * sit outside it), so it inherits `OpsShell`/`OpsNav` from `ops/layout.tsx`
 * automatically — this component only needs the production gate and the
 * page content, same as `problems/page.tsx`.
 */
export default function DashboardGridPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <DashboardGridClient apiBaseUrl={getPublicApiBaseUrl()} />
}
