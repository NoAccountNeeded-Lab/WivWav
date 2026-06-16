/**
 * Tracks when the user last visited the /filters listings page.
 *
 * Storage: localStorage key `wav-last-visit`, value is an ISO 8601 timestamp.
 *
 * Privacy notes:
 * - No user identity is stored — the timestamp is anonymous.
 * - Data never leaves the browser.
 * - First-time visitors have no stored timestamp, so no "New" badges are shown
 *   until the second visit.
 */

const STORAGE_KEY = 'wav-last-visit'

/**
 * Returns the timestamp (ISO string) of the user's last listings page visit,
 * or null if this is the first visit or localStorage is unavailable.
 */
export function getLastVisitTimestamp(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // localStorage may be blocked (e.g. private browsing on some browsers)
    return null
  }
}

/**
 * Records the current time as the last visit timestamp.
 * Call this after the "new" badges have been shown so that on the next visit
 * only listings newer than the current session appear as new.
 */
export function recordCurrentVisit(): void {
  try {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString())
  } catch {
    // Silently ignore — feature degrades gracefully without storage
  }
}
