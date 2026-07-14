import type { BrowserPage } from '../browser/index.js'

export interface RawSourceListingDates {
  listedAt: string | null
  updatedAt: string | null
}

export interface SourceListingDates {
  sourceListedAt: Date | null
  sourceUpdatedAt: Date | null
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
 * Reads only explicit listing-scoped date metadata. Generic page/article
 * timestamps are intentionally ignored because they may describe site chrome
 * or editorial content rather than the vehicle listing.
 */
export async function evaluateSourceListingDates(page: BrowserPage): Promise<SourceListingDates> {
  const raw = await page.evaluate(function (): RawSourceListingDates {
    const LISTING_TYPES = new Set(['car', 'offer', 'product', 'vehicle'])

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

    function listingRecords(value: unknown): Record<string, unknown>[] {
      if (Array.isArray(value)) return value.flatMap(function (entry) { return listingRecords(entry) })
      const record = asRecord(value)
      if (record === null) return []

      const matchesListing = typeNames(record['@type']).some(function (type) {
        return LISTING_TYPES.has(type)
      })
      const nested = [record['@graph'], record.mainEntity, record.offers, record.itemOffered]
        .flatMap(function (entry) { return listingRecords(entry) })
      return matchesListing ? [record, ...nested] : nested
    }

    function dateValue(record: Record<string, unknown>, keys: string[]): string | null {
      for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string' && value.trim().length > 0) return value.trim()
      }
      return null
    }

    function domDate(itemProps: string[]): string | null {
      const scopes = Array.from(document.querySelectorAll<HTMLElement>('[itemscope][itemtype]'))
        .filter(function (scope) {
          const type = scope.getAttribute('itemtype') ?? ''
          const normalized = type.toLowerCase().split(/[/#]/).at(-1) ?? ''
          return LISTING_TYPES.has(normalized)
        })
      for (const scope of scopes) {
        for (const itemProp of itemProps) {
          const element = scope.querySelector<HTMLElement>(`[itemprop="${itemProp}"]`)
          if (element === null) continue
          const value = element.getAttribute('datetime')
            ?? element.getAttribute('content')
            ?? element.textContent
          if (value !== null && value.trim().length > 0) return value.trim()
        }
      }
      return null
    }

    const records: Record<string, unknown>[] = []
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]').forEach(function (script) {
      try {
        records.push(...listingRecords(JSON.parse(script.textContent ?? 'null') as unknown))
      } catch {
        // Malformed third-party metadata is not a detail extraction failure.
      }
    })

    let listedAt: string | null = null
    let updatedAt: string | null = null
    for (const record of records) {
      listedAt ??= dateValue(record, ['datePosted', 'datePublished', 'dateCreated'])
      updatedAt ??= dateValue(record, ['dateModified'])
      if (listedAt !== null && updatedAt !== null) break
    }

    return {
      listedAt: listedAt ?? domDate(['datePosted', 'datePublished', 'dateCreated']),
      updatedAt: updatedAt ?? domDate(['dateModified']),
    }
  })

  return parseSourceListingDates(raw)
}
