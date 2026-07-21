'use client'

// SPIKE PROTOTYPE for issue #852. Representative apps/web listing-oriented
// surface, modeled loosely on apps/web/src/components/listing/SimilarListings.tsx
// and the vehicle detail page's report-listing action — NOT a copy of
// production code, just enough surface to exercise Button, Tooltip, Dialog,
// Menu, and DataGrid together the way a real listing page would.
import * as React from 'react'
import { Button, IconButton, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, DataGrid } from '..'
import type { GridColDef } from '..'

export interface SimilarListing {
  id: string
  make: string
  model: string
  year: number
  priceCents: number
  distanceMiles: number
}

const columns: GridColDef<SimilarListing>[] = [
  { field: 'year', headerName: 'Year', width: 90 },
  { field: 'make', headerName: 'Make', width: 120 },
  { field: 'model', headerName: 'Model', width: 140 },
  {
    field: 'priceCents',
    headerName: 'Price',
    width: 120,
    valueFormatter: (value: number) => `$${(value / 100).toLocaleString()}`,
  },
  { field: 'distanceMiles', headerName: 'Distance (mi)', width: 130 },
]

export type WebListingSurfaceState = 'loading' | 'error' | 'loaded' | 'empty'

export interface WebListingSurfaceProps {
  state: WebListingSurfaceState
  rows?: SimilarListing[]
}

export function WebListingSurface({ state, rows = [] }: WebListingSurfaceProps) {
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)
  const [reportOpen, setReportOpen] = React.useState(false)

  return (
    <section aria-labelledby="similar-listings-heading" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 id="similar-listings-heading" style={{ margin: 0 }}>
          Similar listings
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip title="Report an issue with this listing">
            <IconButton aria-label="Report listing" onClick={() => setReportOpen(true)}>
              <span aria-hidden="true">⚑</span>
            </IconButton>
          </Tooltip>
          <IconButton
            aria-label="More actions"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <span aria-hidden="true">⋮</span>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => setMenuAnchor(null)}>Share</MenuItem>
            <MenuItem onClick={() => setMenuAnchor(null)}>Save for later</MenuItem>
          </Menu>
        </div>
      </div>

      {state === 'loading' && <p role="status">Loading similar listings…</p>}
      {state === 'error' && (
        <p role="alert">Couldn&apos;t load similar listings. <Button size="small" variant="text">Retry</Button></p>
      )}
      {state === 'empty' && <p>No similar listings found nearby.</p>}
      {state === 'loaded' && (
        <div style={{ height: 280, width: '100%' }}>
          <DataGrid<SimilarListing>
            rows={rows}
            columns={columns}
            density="compact"
            hideFooterSelectedRowCount
            aria-label="Similar listings"
          />
        </div>
      )}

      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} aria-labelledby="report-dialog-title">
        <DialogTitle id="report-dialog-title">Report this listing</DialogTitle>
        <DialogContent>Tell us what looks wrong with this listing.</DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setReportOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setReportOpen(false)}>Submit</Button>
        </DialogActions>
      </Dialog>
    </section>
  )
}
