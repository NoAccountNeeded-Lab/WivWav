import type { ReactNode } from 'react'
import { FacetsStateContext, useFacetsData } from '@/components/use-facets-data'

/** Test stand-in for a page-level facet owner (Discover grid or CategoryBarChart). */
export function FacetsOwner({ children }: { children: ReactNode }) {
  return <FacetsStateContext.Provider value={useFacetsData()}>{children}</FacetsStateContext.Provider>
}
