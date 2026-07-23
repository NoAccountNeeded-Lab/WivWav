import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { WorkspacePreviewClient } from './WorkspacePreviewClient'

/**
 * Dev-only harness for the Ops workspace/panel contract (#854, decision
 * record `docs/design/ui-boundary-and-ops-workspace.md` section 3). Proves
 * `useWorkspaceState` + `WorkspaceGrid` + `WorkspacePanel` — open/focus,
 * column spans, resize, maximize/restore, and URL round-tripping — before
 * #761 wires a real production consumer (run → source → queue → log
 * drill-down). Same 404-outside-development pattern as `inspector-preview`
 * (#733), for the same reason: not registered in `OPS_NAV_GROUPS`, and
 * never reachable in production.
 */
export default function WorkspacePreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <Suspense fallback={null}>
      <WorkspacePreviewClient />
    </Suspense>
  )
}
