/**
 * Keep only absolute `https:` image URLs (#1136). Scraped URLs are untrusted:
 * `http:` causes mixed content, and odd schemes (`javascript:`, `data:`) or
 * internal hosts must never reach `listings.images` / `cardImages`.
 */
export function httpsImageUrls(urls: readonly string[]): string[] {
  return urls.filter((u) => {
    try {
      return new URL(u).protocol === 'https:'
    } catch {
      return false
    }
  })
}
