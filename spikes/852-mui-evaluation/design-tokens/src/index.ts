// SPIKE PROTOTYPE for issue #852 — not the final @wivwav/design-tokens
// package (built in #853). Kept intentionally tiny: just enough semantic
// data for the ui-web prototype's theme adapter to consume.
//
// Platform-neutral: plain TS objects/JSON only. No React, no DOM types, no
// CSS. This is what makes the tokens reusable by a hypothetical future
// native app, per docs/design/ui-boundary-and-ops-workspace.md section 1.

export interface ColorRoles {
  primary: string
  onPrimary: string
  surface: string
  onSurface: string
  border: string
  danger: string
  onDanger: string
  success: string
  warning: string
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
      warning: '#8a5a00',
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
      warning: '#ffd27f',
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
