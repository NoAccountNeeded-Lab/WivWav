'use client'

// Form control primitives. `TextField` and `Select` get a real policy
// change (a visible label is required, not optional) as an a11y guardrail;
// `Checkbox`, `RadioGroup`, `Radio`, and `Switch` are thin pass-throughs
// re-exported by name for the same reason as Overlays.tsx — a concrete,
// reviewable surface rather than the vendor's entire form API.
import * as React from 'react'
import MuiTextField from '@mui/material/TextField'
import type { TextFieldProps as MuiTextFieldProps } from '@mui/material/TextField'
import {
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormHelperText,
} from '@mui/material'
import type {
  CheckboxProps,
  RadioProps,
  RadioGroupProps,
  SwitchProps,
  FormControlLabelProps,
} from '@mui/material'

export {
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  FormControlLabel,
  FormControl,
  FormLabel,
  FormHelperText,
}
export type { CheckboxProps, RadioProps, RadioGroupProps, SwitchProps, FormControlLabelProps }

// `MuiTextFieldProps` is a discriminated union keyed on `variant`, which
// TypeScript won't let an `interface extends` narrow further — an
// intersection type works instead.
export type TextFieldProps = MuiTextFieldProps & {
  label: React.ReactNode
}

export const TextField = React.forwardRef<HTMLDivElement, TextFieldProps>(function TextField(
  { variant = 'outlined', ...rest },
  ref,
) {
  return <MuiTextField ref={ref} variant={variant} {...(rest as MuiTextFieldProps)} />
})
