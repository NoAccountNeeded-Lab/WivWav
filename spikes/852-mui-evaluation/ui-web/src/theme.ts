// SPIKE PROTOTYPE for issue #852. Turns @wivwav/spike-852-design-tokens'
// platform-neutral semantic data into an MUI theme object. Per
// docs/design/ui-boundary-and-ops-workspace.md section 1, ui-web is the
// only package allowed to do this conversion.
import { createTheme } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import { tokens } from '@wivwav/spike-852-design-tokens'

function buildTheme(mode: 'light' | 'dark'): Theme {
  const roles = tokens.color[mode]
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

export const lightTheme = buildTheme('light')
export const darkTheme = buildTheme('dark')
