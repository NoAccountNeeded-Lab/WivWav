'use client'

import { useLastListingsVisit } from './ListingsVisitSession'
import { isListingNewSinceLastVisit } from './new-badge-utils'
import styles from './NewBadge.module.css'

interface NewBadgeProps {
  listedAt: string
}

/**
 * Renders a "New" badge if the listing was added after the user's last visit.
 * Returns null before the visit timestamp is loaded, on first visit, or when
 * the listing is not new relative to the previous session.
 *
 * The previous visit timestamp is captured once by ListingsVisitSession before
 * the current visit is recorded, so soft navigations keep comparing against the
 * previous session timestamp.
 */
export function NewBadge({ listedAt }: NewBadgeProps) {
  const lastVisit = useLastListingsVisit()
  const isNew = isListingNewSinceLastVisit(listedAt, lastVisit)

  if (!isNew) return null

  return (
    // Visible text "New" is read by screen readers; no aria-label needed
    <span className={styles.badge}>New</span>
  )
}

export { isListingNewSinceLastVisit }
