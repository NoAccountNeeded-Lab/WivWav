import { SCRAPER_SOURCE_REGISTRY } from '@wivwav/types'
import type { PrismaClient, Prisma } from '../generated/prisma/index.js'

/**
 * Non-dealer or marketplace hosts (www.-stripped). A host matches when it
 * equals an entry or is a subdomain of it. Registered source hosts are added
 * from SCRAPER_SOURCE_REGISTRY, so a new source is excluded automatically.
 */
const NON_DEALER_HOSTS: readonly string[] = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'linktr.ee',
  'google.com',
  'goo.gl',
  'g.page',
  'craigslist.org',
  'ebay.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
  'yelp.com',
  'cargurus.com',
  'autotrader.com',
  'cars.com',
  'carfax.com',
]

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

function registeredSourceHosts(): string[] {
  const hosts: string[] = []
  for (const entry of SCRAPER_SOURCE_REGISTRY) {
    try {
      hosts.push(stripWww(new URL(entry.baseUrl).hostname.toLowerCase()))
    } catch {
      // A malformed registry baseUrl must not break candidate capture.
    }
  }
  return hosts
}

const DENYLIST: readonly string[] = [...NON_DEALER_HOSTS, ...registeredSourceHosts()]

/** A scheme-less `host[:port][/path]` such as `dealer.com/inventory`. */
const BARE_HOST = /^[^\s:/@?#]+(:\d+)?([/?#]|$)/
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Normalizes a dealer website to `https://host` (lower-case, `www.` stripped,
 * no port/path/query/fragment). Returns null for unparseable input, non-http(s)
 * schemes, IP hosts, single-label hosts and denylisted hosts. Never throws.
 */
export function normalizeDealerSiteOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(BARE_HOST.test(trimmed) ? `https://${trimmed}` : trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = stripWww(url.hostname.toLowerCase().replace(/\.$/, ''))
  if (host === '' || host.startsWith('[') || IPV4_HOST.test(host) || !host.includes('.')) return null
  if (DENYLIST.some((denied) => host === denied || host.endsWith(`.${denied}`))) return null
  return `https://${host}`
}

export interface DealerSiteCandidateInput {
  rawUrl: string | null | undefined
  discoveredVia: 'listing_dealer_website' | 'google_places'
  now: Date
  /** Distinct-listing count: bump by `increment`, or overwrite with `set` (backfill). */
  listingCount?: { increment: number } | { set: number }
  dealerProfileId?: string
  dealerName?: string
  /** False in the backfill so a re-run leaves `lastSeenAt` untouched. Default true. */
  touchLastSeen?: boolean
}

/**
 * Creates or updates the candidate for `rawUrl`'s normalized origin. Returns
 * the origin, or null when the URL is rejected (no row written). Collection
 * only: never creates a Source and never fetches the site.
 */
export async function recordDealerSiteCandidate(
  db: Pick<PrismaClient, 'dealerSiteCandidate'> | Prisma.TransactionClient,
  input: DealerSiteCandidateInput,
): Promise<string | null> {
  const origin = normalizeDealerSiteOrigin(input.rawUrl)
  if (origin === null) return null
  const { listingCount } = input
  const initialCount = listingCount === undefined ? 0 : 'set' in listingCount ? listingCount.set : listingCount.increment
  const profile = {
    ...(input.dealerProfileId !== undefined && { dealerProfileId: input.dealerProfileId }),
    ...(input.dealerName !== undefined && { dealerName: input.dealerName }),
  }
  await db.dealerSiteCandidate.upsert({
    where: { origin },
    create: {
      origin,
      sampleUrl: input.rawUrl!.trim(),
      discoveredVia: input.discoveredVia,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      listingCount: initialCount,
      ...profile,
    },
    update: {
      ...(input.touchLastSeen !== false && { lastSeenAt: input.now }),
      ...(listingCount !== undefined && {
        listingCount: 'set' in listingCount ? listingCount.set : { increment: listingCount.increment },
      }),
      ...profile,
    },
  })
  return origin
}
