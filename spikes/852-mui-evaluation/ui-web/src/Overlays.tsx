'use client'

// SPIKE PROTOTYPE for issue #852. Menu, Dialog, Drawer, Tooltip re-exported
// as thin pass-throughs (no policy divergence identified yet worth adding
// in a throwaway prototype); kept as named exports here rather than raw
// `export * from '@mui/material'` so the eventual #853 foundation package
// has a concrete list to narrow from.
export {
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Tooltip,
} from '@mui/material'
export type {
  MenuProps,
  MenuItemProps,
  DialogProps,
  DrawerProps,
  TooltipProps,
} from '@mui/material'
