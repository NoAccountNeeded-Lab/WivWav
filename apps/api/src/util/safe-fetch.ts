/**
 * safeFetch — fetchWithRetry for untrusted (scraped) URLs (#1136).
 *
 * Requires `https:`, resolves the host and rejects loopback / private /
 * link-local / metadata / CGNAT / ULA / IPv4-mapped addresses, and follows
 * redirects manually (max 3 hops), re-checking every hop. Blocked URLs throw a
 * non-retryable error.
 *
 * ponytail: validate-then-fetch leaves a DNS-rebinding window (fetch resolves
 * again). Pin the resolved IP via an undici Agent `connect.lookup` if needed.
 */
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { AbortError } from 'p-retry'
import { fetchWithRetry, type FetchWithRetryOptions } from './fetch-with-retry.js'

const MAX_REDIRECTS = 3

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  // IPv4-mapped (::ffff:a.b.c.d) needs no rule: BlockList.check matches it against the IPv4 rules above.
  ['64:ff9b::', 96], // NAT64
] as const) blocked.addSubnet(net, prefix, 'ipv6')

function reject(message: string): never {
  throw new AbortError(`blocked URL: ${message}`)
}

async function assertPublicHttps(url: URL): Promise<void> {
  if (url.protocol !== 'https:') reject(`protocol ${url.protocol} not allowed`)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true })
  if (addrs.length === 0) reject(`${host} did not resolve`)
  for (const { address, family } of addrs) {
    if (blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')) reject(`${host} resolves to a non-public address`)
  }
}

async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url = new URL(input instanceof Request ? input.url : input)
  for (let hop = 0; ; hop++) {
    await assertPublicHttps(url)
    const res = await fetch(url, { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    await res.body?.cancel()
    if (hop >= MAX_REDIRECTS) reject('too many redirects')
    url = new URL(location, url)
  }
}

export function safeFetch(
  url: string | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  return fetchWithRetry(url, init, { ...options, fetchImpl: guardedFetch })
}
