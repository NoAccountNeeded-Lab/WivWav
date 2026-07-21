// Turns @wivwav/design-tokens' platform-neutral semantic data into an MUI
// theme object. Per docs/design/ui-boundary-and-ops-workspace.md section 1,
// @wivwav/ui-web is the only package allowed to perform this conversion —
// apps/web and apps/ops never construct an MUI theme themselves.
import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import { tokens } from '@wivwav/design-tokens'
import type { ColorRoles } from '@wivwav/design-tokens'

function buildTheme(mode: 'light' | 'dark', roles: ColorRoles): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
    palette: {
      mode,
      primary: { main: roles.primary, contrastText: roles.onPrimary },
      error: { main: roles.danger, contrastText: roles.onDanger },
      success: { main: roles.success },
      warning: { main: roles.warning },
      background: { default: roles.surface, paper: roles.surface },
      text: { primary: roles.onSurface },
      divider: roles.border,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: tokens.type.sansFontFamily,
      fontSize: tokens.type.bodySize,
      h1: { fontSize: tokens.type.headingSize, lineHeight: tokens.type.headingLineHeight },
    },
    spacing: tokens.spacing.xs,
    transitions: {
      duration: {
        shortest: tokens.motion.durationShortMs,
        standard: tokens.motion.durationMediumMs,
      },
    },
  })
}

export const lightTheme = buildTheme('light', tokens.color.light)
export const darkTheme = buildTheme('dark', tokens.color.dark)

/**
 * Status → token color role mapping used by `StatusBadge`. Exported so
 * consuming apps can render status-consistent chrome (e.g. a colored dot)
 * outside of `StatusBadge` itself without reaching into MUI's palette
 * directly.
 */
export type StatusVariant = 'success' | 'warning' | 'danger' | 'neutral'

export function statusColorRole(mode: 'light' | 'dark', status: StatusVariant): { main: string; on: string } {
  const roles = tokens.color[mode]
  switch (status) {
    case 'success':
      return { main: roles.success, on: roles.onSuccess }
    case 'warning':
      return { main: roles.warning, on: roles.onWarning }
    case 'danger':
      return { main: roles.danger, on: roles.onDanger }
    case 'neutral':
      return { main: roles.neutral, on: roles.onNeutral }
  }
}
