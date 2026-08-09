import { jitteredSleep } from '../util/jitter-sleep.js'
const BLVD_BASE_URL = 'https://www.blvd.com'
const BLVD_HOSTS = new Set(['blvd.com', 'www.blvd.com'])
const LISTING_CATEGORIES = new Set(['wheelchair-vans', 'wheelchair-trucks'])
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_RATE_LIMIT_MS = 1_000
const DEFAULT_MAX_DEALER_PAGES = 1

export type FetchPage = (url: string) => Promise<string>

export interface BlvdDealerEnrichment {
  dealerWebsite: string | null
  directVehicleUrl: string | null
}

export interface EnrichBlvdDealerListingOptions {
  sourceUrl: string
  vin: string | null
  fetchPage?: FetchPage
  log?: (message: string) => void | Promise<void>
  maxDealerPages?: number
}

interface Anchor {
  href: string
  text: string
}


function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
}

function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

function extractAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = attrs.match(pattern)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const anchors: Anchor[] = []
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const href = extractAttribute(attrs, 'href')
    if (!href) continue

    try {
      const url = new URL(decodeEntities(href), baseUrl)
      if (isHttpUrl(url)) {
        anchors.push({ href: url.toString(), text: stripTags(body) })
      }
    } catch {
      // Ignore malformed href values from third-party dealer pages.
    }
  }

  return anchors
}

export function deriveBlvdDealerProfileUrl(sourceUrl: string): string | null {
  let url: URL

  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }

  if (!BLVD_HOSTS.has(url.hostname.toLowerCase())) return null

  const [category, dealerSlug, vin] = url.pathname.split('/').filter(Boolean)
  if (!LISTING_CATEGORIES.has(category ?? '') || !dealerSlug || !vin) return null

  return `${BLVD_BASE_URL}/wheelchair-van-dealers/${dealerSlug}`
}

export function extractDealerWebsiteFromProfileHtml(html: string, profileUrl: string): string | null {
  const dealerLink = extractAnchors(html, profileUrl).find((anchor) =>
    /visit\s+dealer'?s\s+website/i.test(anchor.text)
  )

  return dealerLink?.href ?? null
}

export function extractVinSpecificUrlFromDealerHtml(html: string, dealerWebsite: string, vin: string): string | null {
  const normalizedVin = normalizeVin(vin)
  if (!normalizedVin) return null

  const matchingAnchor = extractAnchors(html, dealerWebsite).find((anchor) => {
    const href = anchor.href.toUpperCase()
    const text = anchor.text.toUpperCase()
    if (!href.includes(normalizedVin) && !text.includes(normalizedVin)) return false

    try {
      return !BLVD_HOSTS.has(new URL(anchor.href).hostname.toLowerCase())
    } catch {
      return false
    }
  })

  return matchingAnchor?.href ?? null
}

export async function fetchHtml(url: string, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WivWav/1.0 (wivwav.com)' },
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  return res.text()
}

export function createRateLimitedFetcher(fetchPage: FetchPage, rateLimitMs = DEFAULT_RATE_LIMIT_MS): FetchPage {
  let lastRequestAt: number | null = null

  return async (url: string): Promise<string> => {
    const elapsed = lastRequestAt === null ? rateLimitMs : Date.now() - lastRequestAt
    if (elapsed < rateLimitMs) {
      await jitteredSleep(rateLimitMs - elapsed)
    }

    lastRequestAt = Date.now()
    return fetchPage(url)
  }
}

export async function enrichBlvdDealerListing(options: EnrichBlvdDealerListingOptions): Promise<BlvdDealerEnrichment> {
  const profileUrl = deriveBlvdDealerProfileUrl(options.sourceUrl)
  if (!profileUrl) return { dealerWebsite: null, directVehicleUrl: null }

  const fetchPage = options.fetchPage ?? fetchHtml
  const log = options.log
  const maxDealerPages = options.maxDealerPages ?? DEFAULT_MAX_DEALER_PAGES

  let profileHtml: string
  try {
    profileHtml = await fetchPage(profileUrl)
  } catch (err) {
    await log?.(`[blvd-enrich] Dealer profile lookup failed for ${options.sourceUrl}: ${err}`)
    return { dealerWebsite: null, directVehicleUrl: null }
  }

  const dealerWebsite = extractDealerWebsiteFromProfileHtml(profileHtml, profileUrl)
  if (!dealerWebsite) {
    await log?.(`[blvd-enrich] Dealer website link not found for ${profileUrl}`)
    return { dealerWebsite: null, directVehicleUrl: null }
  }

  if (!options.vin || maxDealerPages < 1) {
    return { dealerWebsite, directVehicleUrl: null }
  }

  let dealerHtml: string
  try {
    dealerHtml = await fetchPage(dealerWebsite)
  } catch (err) {
    await log?.(`[blvd-enrich] Dealer website VIN lookup failed for ${dealerWebsite}: ${err}`)
    return { dealerWebsite, directVehicleUrl: null }
  }

  const directVehicleUrl = extractVinSpecificUrlFromDealerHtml(dealerHtml, dealerWebsite, options.vin)
  if (!directVehicleUrl) {
    await log?.(`[blvd-enrich] No high-confidence VIN page found for ${options.vin} at ${dealerWebsite}`)
  }

  return { dealerWebsite, directVehicleUrl }
}
