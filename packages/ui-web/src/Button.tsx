'use client'

// "Policy-bearing wrapper": fixes a default variant/size so app code can't
// drift, and tightens a11y-relevant prop types MUI itself leaves optional,
// without hiding the underlying MUI prop surface.
import * as React from 'react'
import MuiButton from '@mui/material/Button'
import type { ButtonProps as MuiButtonProps } from '@mui/material/Button'
import MuiIconButton from '@mui/material/IconButton'
import type { IconButtonProps as MuiIconButtonProps } from '@mui/material/IconButton'

export type ButtonProps = MuiButtonProps

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'contained', size = 'medium', ...rest },
  ref,
) {
  return <MuiButton ref={ref} variant={variant} size={size} {...rest} />
})

export interface IconButtonProps extends MuiIconButtonProps {
  /** Required (not optional) here — an a11y guardrail MUI itself leaves optional. */
  'aria-label': string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'medium', ...rest },
  ref,
) {
  return <MuiIconButton ref={ref} size={size} {...rest} />
})
