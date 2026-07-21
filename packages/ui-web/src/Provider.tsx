'use client'

import * as React from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { lightTheme, darkTheme } from './theme'

export interface UiWebProviderProps {
  mode?: 'light' | 'dark'
  children: React.ReactNode
}

/**
 * Root provider a consuming app (`apps/web`, `apps/ops`) mounts once near
 * the layout root. This is the only place `@wivwav/design-tokens`' data is
 * turned into live theme context; primitives below never build their own
 * theme.
 */
export function UiWebProvider({ mode = 'light', children }: UiWebProviderProps) {
  const theme = mode === 'dark' ? darkTheme : lightTheme
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
