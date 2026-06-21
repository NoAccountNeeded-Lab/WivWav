'use client'

import { useEffect } from 'react'
import { recordCurrentVisit } from '@/lib/last-visit'

/**
 * Records the current page load time as the user's last visit to the listings
 * page. Rendered inside the filters page so the timestamp is updated on each
 * visit — meaning on the *next* visit, only listings newer than the current
 * session's load time will be marked "New".
 *
 * No visible output — purely a side-effect component.
 */
export function VisitTracker() {
  useEffect(() => {
    recordCurrentVisit()
  }, [])

  return null
}
