/**
 * Detects whether a fetched page is actually bot-management content (a
 * challenge/CAPTCHA page, or a blocking status code) rather than the real
 * page — pure, fetcher-agnostic, shared by every PageFetcher implementation
 * (#1041). Live-verified 2026-10 against BLVD/Freedom Motors/Superior Van:
 * none triggered any of this during a realistic jittered crawl, but
 * Freedom Motors and Superior Van sit behind Cloudflare, which has these
 * features available even though they weren't observed firing.
 */

export interface BlockCheckResult {
  blocked: boolean
  reason: string | null
}

const BLOCK_STATUS_CODES = new Set([403, 429, 503])

const BODY_SIGNATURES: ReadonlyArray<{ reason: string; pattern: RegExp }> = [
  { reason: 'cloudflare_challenge', pattern: /cf-browser-verification|Just a moment|__cf_chl_/i },
  { reason: 'perimeterx_challenge', pattern: /_pxhd|PerimeterX/i },
  { reason: 'datadome_challenge', pattern: /datadome/i },
  { reason: 'incapsula_challenge', pattern: /incapsula|_Incapsula_Resource/i },
  { reason: 'generic_captcha', pattern: /\bcaptcha\b/i },
]

/**
 * Only the first few KB of a page need checking — challenge pages put their
 * tells in the head/early body, and sampling the full HTML of a large real
 * listing page on every fetch is wasted work.
 */
const BODY_SAMPLE_LENGTH = 5000

export function checkForBlock(statusCode: number | null, body: string): BlockCheckResult {
  if (statusCode !== null && BLOCK_STATUS_CODES.has(statusCode)) {
    return { blocked: true, reason: `status_${statusCode}` }
  }

  const sample = body.slice(0, BODY_SAMPLE_LENGTH)
  for (const { reason, pattern } of BODY_SIGNATURES) {
    if (pattern.test(sample)) return { blocked: true, reason }
  }

  return { blocked: false, reason: null }
}
