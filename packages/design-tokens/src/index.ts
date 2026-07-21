// Platform-neutral semantic design tokens: color roles, spacing scale, type
// scale, motion durations, expressed as plain data (TS objects), never CSS
// or React. Per docs/design/ui-boundary-and-ops-workspace.md section 1,
// `@wivwav/ui-web` is the only package allowed to turn this data into CSS
// variables/an MUI theme object; a hypothetical future `@wivwav/ui-native`
// would translate the same data into native primitives instead. Do not add
// React, DOM, `next`, or CSS-in-JS types to this package.

export interface ColorRoles {
  primary: string
  onPrimary: string
  surface: string
  onSurface: string
  border: string
  danger: string
  onDanger: string
  success: string
  /** Text/icon color guaranteed to meet WCAG 2.1 AA contrast against `success`. */
  onSuccess: string
  warning: string
  /** Text/icon color guaranteed to meet WCAG 2.1 AA contrast against `warning`. */
  onWarning: string
  /** Backing color for neutral/informational status presentation (badges, chips). */
  neutral: string
  onNeutral: string
}

export interface SpacingScale {
  xs: number
  sm: number
  md: number
  lg: number
  xl: number
}

export interface TypeScale {
  bodySize: number
  bodyLineHeight: number
  headingSize: number
  headingLineHeight: number
  monoFontFamily: string
  sansFontFamily: string
}

export interface MotionTokens {
  durationShortMs: number
  durationMediumMs: number
}

export interface SemanticTokens {
  color: {
    light: ColorRoles
    dark: ColorRoles
  }
  spacing: SpacingScale
  type: TypeScale
  motion: MotionTokens
}

export const tokens: SemanticTokens = {
  color: {
    light: {
      primary: '#0052a3',
      onPrimary: '#ffffff',
      surface: '#ffffff',
      onSurface: '#1a1a1a',
      border: '#e5e7eb',
      danger: '#b3261e',
      onDanger: '#ffffff',
      success: '#1e7e34',
      onSuccess: '#ffffff',
      warning: '#8a5a00',
      onWarning: '#ffffff',
      neutral: '#5b6270',
      onNeutral: '#ffffff',
    },
    dark: {
      primary: '#7fb3ff',
      onPrimary: '#00264d',
      surface: '#121212',
      onSurface: '#f2f2f2',
      border: '#333333',
      danger: '#ffb4ab',
      onDanger: '#690005',
      success: '#7fdb8f',
      onSuccess: '#1a1a1a',
      warning: '#ffd27f',
      onWarning: '#1a1a1a',
      neutral: '#9aa1ad',
      onNeutral: '#1a1c20',
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  type: {
    bodySize: 16,
    bodyLineHeight: 1.5,
    headingSize: 24,
    headingLineHeight: 1.25,
    monoFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    sansFontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  motion: {
    durationShortMs: 120,
    durationMediumMs: 240,
  },
}
