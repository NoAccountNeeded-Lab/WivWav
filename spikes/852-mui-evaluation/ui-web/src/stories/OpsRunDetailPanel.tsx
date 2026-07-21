'use client'

// SPIKE PROTOTYPE for issue #852. Representative apps/ops run-detail panel,
// modeled loosely on apps/ops/src/components/Inspector/InspectorPanel.tsx
// and apps/ops/src/app/ops/runs/RunsClient.tsx — NOT a copy of production
// code, just enough surface to exercise Drawer, Menu, Tooltip, and
// DataGrid the way the real run/log inspector would.
import * as React from 'react'
import { Button, IconButton, Menu, MenuItem, Drawer, Tooltip, DataGrid } from '..'
import type { GridColDef } from '..'

export interface RunLogRow {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const columns: GridColDef<RunLogRow>[] = [
  { field: 'timestamp', headerName: 'Time', width: 180 },
  { field: 'level', headerName: 'Level', width: 90 },
  { field: 'message', headerName: 'Message', flex: 1 },
]

export type OpsRunDetailState = 'loading' | 'error' | 'running' | 'complete'

export interface OpsRunDetailPanelProps {
  state: OpsRunDetailState
  logRows?: RunLogRow[]
}

export function OpsRunDetailPanel({ state, logRows = [] }: OpsRunDetailPanelProps) {
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  return (
    <section aria-labelledby="run-panel-heading" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 id="run-panel-heading" style={{ margin: 0 }}>
          Run #1234 — blvd
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {state === 'running' && (
            <span role="status" style={{ fontWeight: 600 }}>
              Running…
            </span>
          )}
          <Tooltip title="View related source">
            <Button size="small" variant="outlined" onClick={() => setDrawerOpen(true)}>
              Source: blvd
            </Button>
          </Tooltip>
          <IconButton
            aria-label="Run actions"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <span aria-hidden="true">⋮</span>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => setMenuAnchor(null)}>Retry run</MenuItem>
            <MenuItem onClick={() => setMenuAnchor(null)}>Cancel run</MenuItem>
          </Menu>
        </div>
      </div>

      {state === 'loading' && <p role="status">Loading run…</p>}
      {state === 'error' && <p role="alert">Failed to load run 1234.</p>}
      {(state === 'running' || state === 'complete') && (
        <div style={{ height: 320, width: '100%' }}>
          <DataGrid<RunLogRow>
            rows={logRows}
            columns={columns}
            density="compact"
            hideFooterSelectedRowCount
            aria-label="Run log entries"
          />
        </div>
      )}

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div style={{ padding: 16, width: 320 }}>
          <h3>Source: blvd</h3>
          <p>Adapter details would render here.</p>
          <Button onClick={() => setDrawerOpen(false)}>Close</Button>
        </div>
      </Drawer>
    </section>
  )
}
