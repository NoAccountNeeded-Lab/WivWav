import { normalizeFacetsData } from '@/components/category-facets'
import type { BarDatum, FacetsData } from '@/components/category-facets'

const BUCKET_SIZE_DOLLARS = 5000

export interface PriceBudget {
  /** Dollar bounds, as in the facets bucket key. */
  lo: number
  hi: number
  count: number
}

export interface HomeSnapshot {
  total: number
  calculatedAt: string
  states: BarDatum[]
  entryTypes: BarDatum[]
  budgets: PriceBudget[]
  /** Eligible listings missing the field; null when the facet gives no basis to compute it. */
  missing: { state: number; entryType: number; price: number }
}

export type HomeSnapshotResult =
  | { status: 'ok'; snapshot: HomeSnapshot }
  | { status: 'unavailable' }

const sum = (bars: Array<{ count: number }>) => bars.reduce((n, b) => n + b.count, 0)

function parseBudgets(buckets: FacetsData['priceDistribution']): PriceBudget[] {
  return buckets.flatMap(({ bucket, count }) => {
    const [loRaw, hiRaw] = bucket.split('-')
    const lo = Number.parseInt(loRaw ?? '', 10)
    const hi = hiRaw === undefined ? lo + BUCKET_SIZE_DOLLARS : Number.parseInt(hiRaw, 10)
    return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && count > 0 ? [{ lo, hi, count }] : []
  })
}

/**
 * A payload without a calculation time is either a pre-contract cached value or
 * the API's outage fallback (zeroed distributions); neither may be shown as fact.
 */
export function buildHomeSnapshot(raw: unknown): HomeSnapshotResult {
  const facets = normalizeFacetsData(raw)
  if (facets.total === null || facets.calculatedAt === null) return { status: 'unavailable' }
  const total = facets.total
  const entryTypes = facets.conversionBreakdown.filter((b) => b.value !== 'unknown' && b.count > 0)
  const budgets = parseBudgets(facets.priceDistribution)
  const states = facets.stateBreakdown.filter((b) => b.count > 0).sort((a, b) => b.count - a.count)
  return {
    status: 'ok',
    snapshot: {
      total,
      calculatedAt: facets.calculatedAt,
      states,
      entryTypes,
      budgets,
      missing: {
        state: Math.max(0, total - sum(states)),
        entryType: Math.max(0, total - sum(entryTypes)),
        price: Math.max(0, total - sum(budgets)),
      },
    },
  }
}

export async function fetchHomeSnapshot(
  base: string,
  fetcher: (url: string, init?: RequestInit & { next?: { revalidate: number } }) => Promise<Response>,
): Promise<HomeSnapshotResult> {
  try {
    const res = await fetcher(`${base}/v1/listings/facets`, { next: { revalidate: 300 } })
    if (!res.ok) return { status: 'unavailable' }
    return buildHomeSnapshot(((await res.json()) as { data?: unknown }).data)
  } catch {
    return { status: 'unavailable' }
  }
}
