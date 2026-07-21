'use client'

// SPIKE PROTOTYPE for issue #852.
import * as React from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { lightTheme, darkTheme } from './theme'

export interface UiWebProviderProps {
  mode?: 'light' | 'dark'
  children: React.ReactNode
}

/** Root provider a consuming app mounts once near the layout root. */
export function UiWebProvider({ mode = 'light', children }: UiWebProviderProps) {
  const theme = mode === 'dark' ? darkTheme : lightTheme
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
