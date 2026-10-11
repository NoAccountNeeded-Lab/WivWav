/** Per-photo report entries and usage totals for the local image-analysis runner (#1112). */

import type { AnalysisUsage, ImageAnalysisExtras } from '../images/image-analysis-provider.js'

export interface LocalRunEntry {
  imageId: string | null
  listingId?: string
  url: string
  outcome: 'planned' | 'valid' | 'invalid' | 'error' | 'download_failed' | 'stored'
  detail?: string
  result?: unknown
  /** Extra details (color, maker, view angle, quality); reported but never stored. */
  extras?: ImageAnalysisExtras
  /** This photo's share of the call's usage (the call's usage divided by `batchSize`). */
  usage?: AnalysisUsage
  /** Photos that shared the model call; 1 when analyzed on its own. */
  batchSize?: number
  seconds: number
}

export interface UsageTotals {
  photos: number
  listings: number
  /** Model calls made (a batch counts once). */
  calls: number
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  avgSecondsPerPhoto: number
  /** Projected API-equivalent cost for 1,000 photos; null when no cost was reported. */
  costPer1000Photos: number | null
  /** Average API-equivalent cost per listing analyzed; null when no cost was reported. */
  costPerListing: number | null
}

export const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places
export function summarizeUsage(entries: LocalRunEntry[]): UsageTotals {
  const used = entries.filter((e) => e.usage !== undefined)
  const costs = used.map((e) => e.usage!.costUsd).filter((c): c is number => c !== null)
  const costUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null
  const listings = new Set(used.map((e) => e.listingId ?? e.imageId ?? e.url)).size
  return {
    photos: used.length,
    listings,
    calls: Math.round(used.reduce((a, e) => a + 1 / (e.batchSize ?? 1), 0)),
    costUsd,
    inputTokens: Math.round(used.reduce((a, e) => a + (e.usage!.inputTokens ?? 0), 0)),
    outputTokens: Math.round(used.reduce((a, e) => a + (e.usage!.outputTokens ?? 0), 0)),
    avgSecondsPerPhoto: used.length > 0 ? round(used.reduce((a, e) => a + e.seconds, 0) / used.length, 1) : 0,
    costPer1000Photos: costUsd !== null ? round((costUsd / costs.length) * 1000, 2) : null,
    costPerListing: costUsd !== null && listings > 0 ? round(costUsd / listings, 4) : null,
  }
}

/** Splits one call's usage evenly across the photos that shared it. */
export function shareUsage(usage: AnalysisUsage | null | undefined, photos: number): AnalysisUsage | undefined {
  if (!usage) return undefined
  const part = (value: number | null): number | null => (value === null ? null : value / photos)
  return {
    model: usage.model,
    costUsd: part(usage.costUsd),
    inputTokens: part(usage.inputTokens),
    outputTokens: part(usage.outputTokens),
    cachedInputTokens: part(usage.cachedInputTokens),
    durationMs: part(usage.durationMs),
  }
}
