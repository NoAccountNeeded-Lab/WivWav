'use client'

// SPIKE PROTOTYPE for issue #852. Community-edition-only re-export.
//
// DELIBERATE: import from '@mui/x-data-grid' (Community, MIT), never from
// '@mui/x-data-grid-pro' or '@mui/x-data-grid-premium' (commercial EULA).
// Per docs/design/ui-boundary-and-ops-workspace.md section 2, Pro/Premium
// must never be added as a dependency anywhere in this workspace.
export { DataGrid } from '@mui/x-data-grid'
export type { GridColDef, DataGridProps } from '@mui/x-data-grid'
