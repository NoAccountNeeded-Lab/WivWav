/**
 * image-normalizer — strip tracking/variant query parameters from image URLs
 * so that byte-identical images served from different CDN variants or with
 * different tracking parameters are recognised as the same image.
 *
 * Design constraints:
 * - Pure function, no I/O.
 * - Returns the input unchanged when URL parsing fails (never throws).
 * - Retains parameters that affect image content (width, height, quality, format).
 * - Strips parameters that are tracking-only or CDN routing hints.
 */

/** Query parameters that are purely tracking / analytics and do not affect image content. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // Generic analytics
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'twclid',
  // CDN cache-busting / versioning tokens that don't affect pixel content
  'cache_buster', 'cb', 'v', 'ver', 'version', '_t', '_ts',
  // Dealer / inventory tracking
  'source', 'ref', 'referral', 'sid', 'tracking', 'uid',
])

/** Path patterns that indicate site-chrome, tracking pixels, or non-vehicle imagery. */
const SITE_CHROME_PATH_RE =
  /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker)\b/i

/**
 * Normalise an image URL for stable deduplication across CDN variant URLs.
 *
 * Returns the original URL string unchanged if parsing fails.
 */
export function normalizeImageUrl(rawUrl: string): string {
  if (rawUrl.startsWith('data:')) return rawUrl

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return rawUrl
  }

  // Remove only known-tracking params; leave content-affecting params (w, h, q, fit, etc.)
  const keysToDelete: string[] = []
  for (const key of parsed.searchParams.keys()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      keysToDelete.push(key)
    }
  }
  for (const key of keysToDelete) {
    parsed.searchParams.delete(key)
  }

  // Sort remaining params for a stable canonical form
  parsed.searchParams.sort()

  return parsed.toString()
}

/**
 * Returns true when the URL's path matches known site-chrome patterns
 * (logos, icons, tracking pixels, etc.) regardless of content analysis.
 */
export function isSiteChromeUrl(url: string): boolean {
  if (url.startsWith('data:')) return true
  try {
    const parsed = new URL(url)
    return SITE_CHROME_PATH_RE.test(parsed.pathname)
  } catch {
    return false
  }
}
