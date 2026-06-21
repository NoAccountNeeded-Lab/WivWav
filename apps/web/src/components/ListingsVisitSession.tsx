'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { getLastVisitTimestamp, recordCurrentVisit } from '@/lib/last-visit'

type LastVisitState = string | null | undefined

const LastVisitContext = createContext<LastVisitState>(undefined)

interface ListingsVisitSessionProps {
  children: ReactNode
}

export function ListingsVisitSession({ children }: ListingsVisitSessionProps) {
  const [lastVisit, setLastVisit] = useState<LastVisitState>(undefined)

  useEffect(() => {
    const previousVisit = getLastVisitTimestamp()
    setLastVisit(previousVisit)
    recordCurrentVisit()
  }, [])

  return (
    <LastVisitContext.Provider value={lastVisit}>
      {children}
    </LastVisitContext.Provider>
  )
}

export function useLastListingsVisit() {
  return useContext(LastVisitContext)
}
