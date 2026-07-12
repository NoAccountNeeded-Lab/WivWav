import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { InspectorPreviewClient } from './InspectorPreviewClient'

/**
 * Dev-only harness for E6 (#733): proves the `InspectorPanel` architecture —
 * docked at >=1280px, full-screen sheet below it, URL-driven state that
 * survives a full reload — before any production route consumes it
 * (deferred to F1/F2, per A6). Composes `OpsShell` directly (same pattern as
 * `/status`) rather than nesting under `/ops/layout.tsx`, and is not
 * registered in `OPS_NAV_GROUPS`, so no navigation surface links to it. 404s
 * outside development so it never ships as a reachable route.
 */
export default function InspectorPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <Suspense fallback={null}>
      <InspectorPreviewClient />
    </Suspense>
  )
}
