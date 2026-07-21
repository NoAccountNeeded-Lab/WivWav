// The sole browser component-vendor boundary for apps/web and apps/ops. See
// docs/design/ui-boundary-and-ops-workspace.md section 1 for the accepted
// package boundary and import rules; the ESLint `no-restricted-imports`
// rule in packages/config/eslint.config.js enforces that those two app
// workspaces consume only this exported surface, never `@mui/*` or
// `@emotion/*` directly.
export { UiWebProvider } from './Provider'
export type { UiWebProviderProps } from './Provider'

export { lightTheme, darkTheme, statusColorRole } from './theme'
export type { StatusVariant } from './theme'

export { Button, IconButton } from './Button'
export type { ButtonProps, IconButtonProps } from './Button'

export { Link } from './Link'
export type { LinkProps } from './Link'

export {
  Menu,
  MenuItem,
  ContextMenu,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  Tooltip,
} from './Overlays'
export type {
  MenuProps,
  MenuItemProps,
  ContextMenuProps,
  DialogProps,
  DrawerProps,
  TooltipProps,
} from './Overlays'

export {
  TextField,
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormHelperText,
} from './FormControls'
export type {
  TextFieldProps,
  CheckboxProps,
  RadioProps,
  RadioGroupProps,
  SwitchProps,
  FormControlLabelProps,
} from './FormControls'

export { StatusBadge } from './StatusBadge'
export type { StatusBadgeProps } from './StatusBadge'

export { DataGrid } from './DataGrid'
export type { GridColDef, DataGridProps } from './DataGrid'
