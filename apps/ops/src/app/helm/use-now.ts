'use client'

import { useEffect, useState } from 'react'

/** Wall-clock `Date.now()` re-read every `intervalMs`, so freshness labels age even when no fetch settles. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
