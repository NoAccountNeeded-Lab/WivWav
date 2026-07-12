export const OPS_BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1536,
} as const

export type OpsBreakpointKey = keyof typeof OPS_BREAKPOINTS
