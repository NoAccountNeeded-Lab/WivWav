'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { OPS_INSPECTOR_SLOT_ID } from './inspector-slot'

interface InspectorPortalProps {
  children: ReactNode
}

/**
 * Renders `children` (typically an `InspectorPanel`) into the `OpsShell` inspector
 * grid slot from a route nested under `OpsLayout` (`apps/ops/src/app/ops/layout.tsx`),
 * which owns the single `OpsShell` instance shared by every `/ops/*` page and does not
 * forward a page-specific `inspector` prop. See `inspector-slot.ts`.
 *
 * Portals only after mount (`document` is unavailable during the server render pass of
 * this client component), so it renders nothing on the server and briefly nothing on
 * the client until the effect runs — matching `InspectorPanel`'s own `isOpen` gate,
 * which already returns `null` when closed.
 */
export function InspectorPortal({ children }: InspectorPortalProps) {
  const [target, setTarget] = useState<Element | null>(null)

  useEffect(() => {
    setTarget(document.getElementById(OPS_INSPECTOR_SLOT_ID))
  }, [])

  if (!target) return null
  return createPortal(children, target)
}
