/**
 * DOM id for the `OpsShell` inspector grid slot. `OpsLayout` (`apps/ops/src/app/ops/layout.tsx`)
 * mounts one `OpsShell` for every route under `/ops`, so a leaf page cannot pass its own
 * `inspector` prop up to it directly. `InspectorPortal` renders a page's `InspectorPanel` into
 * this element via `createPortal` instead, so any route can become an inspector consumer
 * without `OpsLayout` knowing about it (E6/#761).
 */
export const OPS_INSPECTOR_SLOT_ID = 'ops-inspector-slot'
