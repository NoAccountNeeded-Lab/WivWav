/**
 * robots-cache — fetches, parses, and caches robots.txt per origin for the
 * lifetime of a scrape run.
 *
 * Usage:
 *   const cache = new RobotsCache()
 *   const allowed = await cache.isAllowed('https://example.com/some/path', 'WivWav/1.0')
 *
 * Design decisions:
 *   - A missing or malformed robots.txt is treated as fully permissive (open)
 *   - Cache is keyed by origin (scheme + host + port), not by individual URL
 *   - `fetchRobots` can be injected for testing; defaults to global `fetch`
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// robots-parser is a CommonJS module; use require() to get the callable function.
const robotsParser: (url: string, text: string) => Robot = require('robots-parser')

// The Robot interface returned by robots-parser
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined
  isDisallowed(url: string, ua?: string): boolean | undefined
}

export type FetchFn = (url: string) => Promise<Response>

export class RobotsCache {
  /** Parsed robots.txt per origin. `null` = permissive (no robots.txt). */
  private readonly cache = new Map<string, Robot | null>()
  private readonly fetchFn: FetchFn

  constructor(fetchFn: FetchFn = (url) => fetch(url)) {
    this.fetchFn = fetchFn
  }

  /**
   * Returns true when the URL is allowed for the given user-agent, false when
   * explicitly disallowed. A missing / unparseable robots.txt returns true.
   */
  async isAllowed(url: string, userAgent = '*'): Promise<boolean> {
    const robots = await this.getRobotsForUrl(url)
    if (robots === null) return true
    return robots.isAllowed(url, userAgent) !== false
  }

  /** Flush the cache (call between scrape runs if needed). */
  clear(): void {
    this.cache.clear()
  }

  private async getRobotsForUrl(url: string): Promise<Robot | null> {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return null
    }

    if (this.cache.has(origin)) {
      return this.cache.get(origin) ?? null
    }

    const robotsUrl = `${origin}/robots.txt`
    const parsed = await this.fetchAndParse(robotsUrl)
    this.cache.set(origin, parsed)
    return parsed
  }

  private async fetchAndParse(robotsUrl: string): Promise<Robot | null> {
    try {
      const res = await this.fetchFn(robotsUrl)
      if (!res.ok) {
        // 404 or other error — treat as permissive
        return null
      }
      const text = await res.text()
      return robotsParser(robotsUrl, text)
    } catch {
      // Network error — treat as permissive
      return null
    }
  }
}
