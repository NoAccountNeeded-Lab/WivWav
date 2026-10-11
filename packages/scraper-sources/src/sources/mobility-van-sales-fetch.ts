import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { withTransientNetworkRetry } from '../util/network-retry.js'
import { USER_AGENT } from './mobility-van-sales-constants.js'

const REQUEST_TIMEOUT_MS = 15_000


/** Minimal fetch result shape — testable without depending on the global fetch signature. */
export interface FetchResult {
  url: string
  status: number
  text: string
}

export type FetchPage = (url: string) => Promise<FetchResult>

export function defaultFetchPage(url: string): Promise<FetchResult> {
  return fetchWithTlsBypass(url, { 'User-Agent': USER_AGENT }, REQUEST_TIMEOUT_MS)
}

async function fetchWithTlsBypass(
  startUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRedirects = 5,
): Promise<FetchResult> {
  const startHostname = new URL(startUrl).hostname
  let currentUrl = startUrl

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    // One dropped connection or stall must not fail a 100+ request run, so each
    // request is retried a bounded number of times on transient network errors.
    const result = await withTransientNetworkRetry(() => fetchOnce(currentUrl, headers, timeoutMs))
    if (result.status >= 300 && result.status < 400 && result.location) {
      const redirectUrl = new URL(result.location, currentUrl)
      // Because TLS validation is bypassed for TLS_BYPASS_HOSTNAME, an on-path
      // attacker who MITMs that host could otherwise inject a redirect to an
      // arbitrary (e.g. internal) host. Refuse to follow off-host redirects.
      if (redirectUrl.hostname !== startHostname || redirectUrl.protocol !== 'https:') {
        throw new Error(`[mobility-van-sales] Refusing cross-host redirect from ${currentUrl} to ${redirectUrl}`)
      }
      currentUrl = redirectUrl.toString()
      continue
    }
    return { url: currentUrl, status: result.status, text: result.text }
  }

  throw new Error(`[mobility-van-sales] Too many redirects for ${startUrl}`)
}

const TLS_BYPASS_HOSTNAME = 'www.mobilityvansales.com'

function fetchOnce(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; text: string; location: string | null }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const requestFn = isHttps ? httpsRequest : httpRequest
    const bypassTls = isHttps && parsed.hostname === TLS_BYPASS_HOSTNAME

    const req = requestFn(
      url,
      {
        headers,
        method: 'GET',
        // Fresh socket per request: the default keep-alive agent can reuse a
        // socket the server already closed, which surfaces as `socket hang up`.
        agent: false,
        ...(bypassTls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            location: res.headers.location ?? null,
          })
        })
      },
    )

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`[mobility-van-sales] Request timed out after ${timeoutMs}ms for ${url}`))
    })
    req.end()
  })
}
