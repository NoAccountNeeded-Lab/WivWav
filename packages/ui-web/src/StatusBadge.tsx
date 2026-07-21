'use client'

// Status/badge presentation primitive. Unlike Overlays/FormControls, this
// has no direct MUI equivalent to pass through — it is a genuine policy
// component built on `Chip` that maps a fixed, closed set of status
// variants onto `@wivwav/design-tokens` color roles via `statusColorRole`,
// so a status badge can never be built with an arbitrary ad hoc color.
import * as React from 'react'
import Chip from '@mui/material/Chip'
import { useTheme } from '@mui/material/styles'
import { statusColorRole } from './theme'
import type { StatusVariant } from './theme'

export interface StatusBadgeProps {
  status: StatusVariant
  label: React.ReactNode
  /** Optional leading icon; decorative only — `label` alone must convey the status. */
  icon?: React.ReactElement
}

export const StatusBadge = React.forwardRef<HTMLDivElement, StatusBadgeProps>(function StatusBadge(
  { status, label, icon },
  ref,
) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { main, on } = statusColorRole(mode, status)

  return (
    <Chip
      ref={ref}
      icon={icon}
      label={label}
      size="small"
      sx={{
        backgroundColor: main,
        color: on,
        fontWeight: 600,
        '& .MuiChip-icon': { color: on },
      }}
    />
  )
})
