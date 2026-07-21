'use client'

// Menu, Dialog, Drawer, Tooltip re-exported as thin pass-throughs (no policy
// divergence identified yet worth wrapping) — kept as named exports here
// rather than `export * from '@mui/material'` so this surface stays a
// concrete, reviewable list rather than the vendor's entire API.
import * as React from 'react'
import {
  Menu as MuiMenu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Tooltip,
} from '@mui/material'
import type {
  MenuProps,
  MenuItemProps,
  DialogProps,
  DrawerProps,
  TooltipProps,
} from '@mui/material'

export { MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Drawer, Tooltip }
export type { MenuProps, MenuItemProps, DialogProps, DrawerProps, TooltipProps }

export const Menu = MuiMenu

export interface ContextMenuProps extends Omit<MenuProps, 'anchorEl' | 'anchorReference' | 'anchorPosition' | 'open'> {
  /** Screen position to anchor at, or `null` when closed. Set from a `contextmenu` event's `{ clientX, clientY }`. */
  anchorPosition: { top: number; left: number } | null
  onClose: NonNullable<MenuProps['onClose']>
  children: React.ReactNode
}

/**
 * Right-click ("context") menu convenience wrapper around MUI's `Menu`,
 * anchored to a screen position rather than a DOM element. MUI has no
 * dedicated `ContextMenu` component; this is the policy-bearing surface
 * `docs/design/ui-boundary-and-ops-workspace.md` section 1 refers to as
 * "Menu/ContextMenu".
 *
 * Usage: track `{ top, left } | null` state, set it from the triggering
 * element's `onContextMenu` handler (calling `event.preventDefault()` there
 * to suppress the native browser context menu), and clear it in `onClose`.
 */
export function ContextMenu({ anchorPosition, onClose, children, ...rest }: ContextMenuProps) {
  return (
    <MuiMenu
      open={anchorPosition !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      {...rest}
    >
      {children}
    </MuiMenu>
  )
}
