'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ActionTracker } from './use-action-tracker'
import type { HelmData } from './use-helm-data'
import type { HelmNavigation } from './use-helm-location'

export interface HelmContextValue {
  apiBaseUrl: string
  data: HelmData
  nav: HelmNavigation
  tracker: ActionTracker
}

const HelmContext = createContext<HelmContextValue | null>(null)

export function HelmProvider({ value, children }: { value: HelmContextValue; children: ReactNode }) {
  return <HelmContext.Provider value={value}>{children}</HelmContext.Provider>
}

export function useHelm(): HelmContextValue {
  const value = useContext(HelmContext)
  if (!value) throw new Error('useHelm must be used inside HelmProvider')
  return value
}
