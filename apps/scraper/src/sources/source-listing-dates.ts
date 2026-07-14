import type { BrowserPage } from '../browser/index.js'

export interface RawSourceListingDates {
  listedAt: string | null
  updatedAt: string | null
}

export interface SourceListingDates {
  sourceListedAt: Date | null
  sourceUpdatedAt: Date | null
}

export interface SourceListingIdentity {
  expectedUrl: string
  expectedVin?: string | null
  expectedSourceIdentifiers?: string[]
}

function parseSourceDate(value: string | null): Date | null {
  if (value === null || value.trim().length === 0) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp) : null
}

/**
 * Converts listing-scoped structured metadata into normalized timestamps.
 * Invalid or missing values remain null so a later incomplete detail scrape
 * never clears an earlier valid source observation.
 */
export function parseSourceListingDates(raw: RawSourceListingDates): SourceListingDates {
  return {
    sourceListedAt: parseSourceDate(raw.listedAt),
    sourceUpdatedAt: parseSourceDate(raw.updatedAt),
  }
}

/**
 * Reads only explicit metadata for the expected vehicle listing. Generic
 * page/article timestamps and unmatched listing records are intentionally
 * ignored because multi-listing pages can contain dates for another vehicle.
 */
export async function evaluateSourceListingDates(
  page: BrowserPage,
  identity: SourceListingIdentity,
): Promise<SourceListingDates> {
  const raw = await page.evaluate(function (expected): RawSourceListingDates {
    const LISTING_TYPES = new Set(['car', 'offer', 'product', 'vehicle'])
    const DATE_KEYS = {
      listed: ['datePosted', 'datePublished', 'dateCreated'],
      updated: ['dateModified'],
    }

    interface DateCandidate extends RawSourceListingDates {
      urls: string[]
      identifiers: string[]
    }

    interface ClassifiedCandidate {
      candidate: DateCandidate
      confidence: 'proven' | 'anonymous' | 'unmatched'
    }

    function asRecord(value: unknown): Record<string, unknown> | null {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
    }

    function typeNames(value: unknown): string[] {
      const values = Array.isArray(value) ? value : [value]
      return values
        .filter(function (entry): entry is string { return typeof entry === 'string' })
        .map(function (entry) {
          return entry.toLowerCase().split(/[/#]/).at(-1) ?? ''
        })
    }

    function stringValues(value: unknown): string[] {
      if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : []
      if (Array.isArray(value)) return value.flatMap(function (entry) { return stringValues(entry) })
      const record = asRecord(value)
      if (record === null) return []
      return [record.value, record['@id']]
        .flatMap(function (entry) { return stringValues(entry) })
    }

    function recordValues(records: Record<string, unknown>[], keys: string[]): string[] {
      return records.flatMap(function (record) {
        return keys.flatMap(function (key) { return stringValues(record[key]) })
      })
    }

    function listingCluster(record: Record<string, unknown>): Record<string, unknown>[] {
      const nested = [record.mainEntity, record.offers, record.itemOffered]
        .flatMap(function (entry) {
          if (Array.isArray(entry)) {
            return entry.flatMap(function (item) {
              const child = asRecord(item)
              return child === null ? [] : listingCluster(child)
            })
          }
          const child = asRecord(entry)
          return child === null ? [] : listingCluster(child)
        })
      return [record, ...nested]
    }

    function dateValue(records: Record<string, unknown>[], keys: string[]): string | null {
      for (const record of records) {
        for (const key of keys) {
          const value = record[key]
          if (typeof value === 'string' && value.trim().length > 0) return value.trim()
        }
      }
      return null
    }

    function jsonCandidates(value: unknown, inheritedUrls: string[] = []): DateCandidate[] {
      if (Array.isArray(value)) {
        return value.flatMap(function (entry) { return jsonCandidates(entry, inheritedUrls) })
      }
      const record = asRecord(value)
      if (record === null) return []

      const matchesListing = typeNames(record['@type']).some(function (type) {
        return LISTING_TYPES.has(type)
      })
      if (matchesListing) {
        const records = listingCluster(record)
        return [{
          listedAt: dateValue(records, DATE_KEYS.listed),
          updatedAt: dateValue(records, DATE_KEYS.updated),
          urls: [...inheritedUrls, ...recordValues(records, ['url', '@id'])],
          identifiers: recordValues(records, [
            'vehicleIdentificationNumber',
            'vin',
            'sku',
            'productID',
            'mpn',
            'identifier',
            'serialNumber',
          ]),
        }]
      }

      const pageUrls = recordValues([record], ['url', '@id'])
      return [
        ...jsonCandidates(record.mainEntity, [...inheritedUrls, ...pageUrls]),
        ...jsonCandidates(record['@graph']),
      ]
    }

    function domValue(scope: HTMLElement, itemProps: string[]): string | null {
      for (const itemProp of itemProps) {
        const element = scope.querySelector<HTMLElement>(`[itemprop~="${itemProp}"]`)
        if (element === null) continue
        const value = element.getAttribute('datetime')
          ?? element.getAttribute('content')
          ?? element.getAttribute('href')
          ?? element.textContent
        if (value !== null && value.trim().length > 0) return value.trim()
      }
      return null
    }

    function microdataCandidates(): DateCandidate[] {
      return Array.from(document.querySelectorAll<HTMLElement>('[itemscope][itemtype]'))
        .filter(function (scope) {
          const type = scope.getAttribute('itemtype') ?? ''
          const normalized = type.toLowerCase().split(/[/#]/).at(-1) ?? ''
          if (!LISTING_TYPES.has(normalized)) return false
          const parentScope = scope.parentElement?.closest<HTMLElement>('[itemscope][itemtype]')
          if (parentScope === null || parentScope === undefined) return true
          const parentType = parentScope.getAttribute('itemtype') ?? ''
          const parentNormalized = parentType.toLowerCase().split(/[/#]/).at(-1) ?? ''
          return !LISTING_TYPES.has(parentNormalized)
        })
        .map(function (scope) {
          const parentScope = scope.getAttribute('itemprop')?.split(/\s+/).includes('mainEntity') === true
            ? scope.parentElement?.closest<HTMLElement>('[itemscope][itemtype]')
            : null
          const inheritedUrls = parentScope === null || parentScope === undefined
            ? []
            : [parentScope.getAttribute('itemid'), domValue(parentScope, ['url'])]
                .filter(function (value): value is string { return value !== null })
          return {
            listedAt: domValue(scope, DATE_KEYS.listed),
            updatedAt: domValue(scope, DATE_KEYS.updated),
            urls: [scope.getAttribute('itemid'), domValue(scope, ['url']), ...inheritedUrls]
              .filter(function (value): value is string { return value !== null }),
            identifiers: [
              domValue(scope, ['vehicleIdentificationNumber']),
              domValue(scope, ['vin']),
              domValue(scope, ['sku']),
              domValue(scope, ['productID']),
              domValue(scope, ['mpn']),
              domValue(scope, ['identifier']),
              domValue(scope, ['serialNumber']),
            ].filter(function (value): value is string { return value !== null }),
          }
        })
    }

    function parsedUrl(value: string): URL | null {
      try {
        const url = new URL(value, expected.expectedUrl)
        url.hash = ''
        if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '')
        return url
      } catch {
        return null
      }
    }

    function urlsMatch(left: string, right: string): boolean {
      const leftUrl = parsedUrl(left)
      const rightUrl = parsedUrl(right)
      if (leftUrl === null || rightUrl === null) return false
      if (leftUrl.href === rightUrl.href) return true
      return leftUrl.origin === rightUrl.origin
        && leftUrl.pathname === rightUrl.pathname
        && (leftUrl.search.length === 0 || rightUrl.search.length === 0)
    }

    function normalizedIdentifier(value: string): string {
      return value.trim().toLowerCase().replace(/\s+/g, '')
    }

    const expectedIdentifiers = [
      expected.expectedVin,
      ...(expected.expectedSourceIdentifiers ?? []),
    ]
      .filter(function (value): value is string { return typeof value === 'string' && value.trim().length > 0 })
      .map(function (value) { return normalizedIdentifier(value) })

    function candidateMatches(candidate: DateCandidate): boolean {
      const urlMatch = candidate.urls.some(function (url) {
        return urlsMatch(url, expected.expectedUrl)
      })
      const identifiers = candidate.identifiers.map(function (value) {
        return normalizedIdentifier(value)
      })
      return urlMatch || expectedIdentifiers.some(function (identifier) {
        return identifiers.includes(identifier)
      })
    }

    function classifyCandidate(candidate: DateCandidate): ClassifiedCandidate {
      if (candidateMatches(candidate)) return { candidate, confidence: 'proven' }
      if (candidate.urls.length === 0 && candidate.identifiers.length === 0) {
        return { candidate, confidence: 'anonymous' }
      }
      return { candidate, confidence: 'unmatched' }
    }

    function mergeDateValues(candidates: DateCandidate[], key: 'listedAt' | 'updatedAt'): string | null {
      const values = Array.from(new Set(candidates
        .map(function (candidate) { return candidate[key] })
        .filter(function (value): value is string { return value !== null })))
      return values.length === 1 ? values[0] ?? null : null
    }

    function mergeCandidates(candidates: DateCandidate[]): RawSourceListingDates {
      return {
        listedAt: mergeDateValues(candidates, 'listedAt'),
        updatedAt: mergeDateValues(candidates, 'updatedAt'),
      }
    }

    const structuredCandidates: DateCandidate[] = []
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach(function (script) {
      try {
        structuredCandidates.push(...jsonCandidates(JSON.parse(script.textContent ?? 'null') as unknown))
      } catch {
        // Malformed third-party metadata is not a detail extraction failure.
      }
    })

    const candidates = [...structuredCandidates, ...microdataCandidates()]
      .map(function (candidate) { return classifyCandidate(candidate) })
    const proven = candidates
      .filter(function (candidate) { return candidate.confidence === 'proven' })
      .map(function (candidate) { return candidate.candidate })

    // Every proven candidate is tied to the same expected URL/VIN/source
    // identity, so duplicate JSON-LD and microdata descriptions may safely
    // contribute complementary dates. Anonymous metadata is never merged
    // into a proven match because it may describe another vehicle.
    if (proven.length > 0) return mergeCandidates(proven)

    // Identity-free fallback remains useful for simple detail pages, but only
    // when there is exactly one listing candidate across every encoding.
    const soleCandidate = candidates.length === 1 ? candidates[0] : undefined
    if (soleCandidate?.confidence === 'anonymous') return mergeCandidates([soleCandidate.candidate])

    return { listedAt: null, updatedAt: null }
  }, identity)

  return parseSourceListingDates(raw)
}
