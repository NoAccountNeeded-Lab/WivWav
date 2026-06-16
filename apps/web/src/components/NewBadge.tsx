'use client'

import { useEffect, useState } from 'react'
import { getLastVisitTimestamp } from '@/lib/last-visit'
import styles from './NewBadge.module.css'

interface NewBadgeProps {
  listedAt: string
}

/**
 * Renders a "New" badge if the listing was added after the user's last visit.
 * Returns null on first visit (no stored timestamp) or when the listing is
 * not new relative to the last visit.
 *
 * Renders nothing during SSR — the badge is purely client-side to avoid
 * hydration mismatches with localStorage.
 */
export function NewBadge({ listedAt }: NewBadgeProps) {
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    const lastVisit = getLastVisitTimestamp()
    if (lastVisit === null) return

    const listedDate = new Date(listedAt)
    if (isNaN(listedDate.getTime())) return

    setIsNew(listedDate > new Date(lastVisit))
  }, [listedAt])

  if (!isNew) return null

  return (
    // Visible text "New" is read by screen readers; no aria-label needed
    <span className={styles.badge}>New</span>
  )
}
