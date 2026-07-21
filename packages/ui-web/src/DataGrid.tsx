'use client'

// Community-edition-only re-export.
//
// DELIBERATE: import from '@mui/x-data-grid' (Community, MIT), never from
// '@mui/x-data-grid-pro' or '@mui/x-data-grid-premium' (commercial EULA).
// Per docs/design/ui-boundary-and-ops-workspace.md section 2, Pro/Premium
// must never be added as a dependency anywhere in this workspace.
//
// Per the #852 spike's follow-up (docs/design/852-mui-evaluation-spike.md
// section 8, item 1), any real usage of `DataGrid` must be code-split via
// `next/dynamic(() => import(...), { ssr: false })` (or an equivalent lazy
// boundary) in the consuming app — importing it eagerly measurably pulled
// an extra ~700 KB raw / ~207 KB gzip into a route's initial chunk.
export { DataGrid } from '@mui/x-data-grid'
export type { GridColDef, DataGridProps } from '@mui/x-data-grid'
