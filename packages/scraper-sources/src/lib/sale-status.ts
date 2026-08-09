import type { SaleStatus } from '@wivwav/types'

/**
 * Parses the SaleStatus from a status banner element's text content.
 *
 * Maps common sold/pending banner strings to the SaleStatus enum:
 * - "Sold"                                      → sold
 * - "No Longer Available", "Unavailable"       → gone
 * - "Pending Sale", "Pending", "Under Contract" → pending
 * - Anything else (including empty string)      → active
 *
 * A text length guard (>= 100 chars) prevents spurious matches from large
 * elements whose class names happen to contain "sold" or "pending" as a
 * substring but whose content is unrelated to listing status.
 */
export function parseSaleStatus(bannerText: string): SaleStatus {
  // Guard: long text is unlikely to be a status banner
  if (bannerText.length >= 100) return 'active'
  const t = bannerText.toLowerCase()
  if (t.includes('pending') || t.includes('under contract')) return 'pending'
  if (t.includes('sold')) return 'sold'
  if (t.includes('no longer available') || t.includes('unavailable')) return 'gone'
  return 'active'
}
