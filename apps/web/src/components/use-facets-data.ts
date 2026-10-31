'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { SHOPPING_FILTER_PARAMS } from '@/lib/shopping-filter-url'
import { getClientApiBaseUrl } from '@/lib/api-url'
import { normalizeFacetsData } from './category-facets'
import type { BarDatum, FacetsData } from './category-facets'

export interface ConversionBrandSummary {
  id: string
  name: string
  slug: string
  productCount: number
}

export type FacetsStatus = 'loading' | 'ready' | 'unavailable'

export type RangeKind = 'price' | 'year' | 'mileage'

/** Params each histogram omits so it stays cross-filtered (its own range never narrows its own bars). */
const RANGE_OMIT: Record<RangeKind, readonly string[]> = {
  price: ['priceMin', 'priceMax'],
  year: ['yearMin', 'yearMax'],
  mileage: ['mileageMax'],
}
const RANGE_KINDS = Object.keys(RANGE_OMIT) as RangeKind[]

export interface FacetsState {
  /** Cross-filtered range data for the histograms, from the same owner. */
  ranges: Record<RangeKind, FacetsData | null>
  /** Last good data. Kept while a newer request is pending or after it fails. */
  data: FacetsData | null
  brands: ConversionBrandSummary[]
  status: FacetsStatus
}

// Disjunctive faceting: while a param is active its own facet is refetched without it.
const DISJUNCTIVE_PARAMS = [...SHOPPING_FILTER_PARAMS, 'make', 'model', 'trim', 'condition', 'conversionType', 'color', 'rampType', 'wavFeatures', 'state', 'sellerType', 'fuelType', 'conversionBrand'] as const

const ALL_FILTER_PARAMS = [
  'q', 'make', 'model', 'trim', 'yearMin', 'yearMax', 'priceMin', 'priceMax',
  'mileageMax', 'condition', 'conversionType', 'rampType', 'wavFeatures',
  ...SHOPPING_FILTER_PARAMS, 'conversionBrand', 'color', 'state', 'sellerType', 'fuelType',
]

const MAX_BARS = 8

function buildFacetsUrl(searchParams: { get: (key: string) => string | null }, omitParam: string | readonly string[] | null): string {
  const omitted = new Set(typeof omitParam === 'string' ? [omitParam] : omitParam ?? [])
  const url = new URL(`${getClientApiBaseUrl()}/v1/listings/facets`)
  for (const key of ALL_FILTER_PARAMS) {
    if (omitted.has(key)) continue
    const val = searchParams.get(key)
    if (val) url.searchParams.set(key, val)
  }
  return url.toString()
}

async function fetchFacets(url: string, signal: AbortSignal): Promise<FacetsData> {
  const res = await fetch(url, { signal })
  if (res.ok === false) throw new Error(`facets ${res.status}`)
  const json = (await res.json()) as { data: unknown }
  return normalizeFacetsData(json.data)
}

async function fetchConversionBrands(signal: AbortSignal): Promise<ConversionBrandSummary[]> {
  try {
    const res = await fetch(`${getClientApiBaseUrl()}/v1/conversion-brands`, { signal })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: ConversionBrandSummary[] }
    return json.data ?? []
  } catch {
    return []
  }
}

/** Keeps just-deselected options visible as zero-count rows so the user can re-pick them. */
function stabilizeBars(current: BarDatum[], previous: BarDatum[]): BarDatum[] {
  const currentSet = new Set(current.map((b) => b.value))
  const ghost = previous
    .filter((b) => !currentSet.has(b.value))
    .map((b) => ({ value: b.value, count: 0 }))
    .slice(0, MAX_BARS)
  return [...current, ...ghost]
}

function mergeDisjunctive(base: FacetsData, param: string, d: FacetsData): void {
  switch (param) {
    case 'city': base.cityBreakdown = d.cityBreakdown; break
    case 'transmission': base.transmissionBreakdown = d.transmissionBreakdown; break
    case 'wheelchairCapacity': base.wheelchairCapacityBreakdown = d.wheelchairCapacityBreakdown; break
    case 'conversionStatus': base.conversionStatusBreakdown = d.conversionStatusBreakdown; break
    case 'make': base.makeBreakdown = d.makeBreakdown; break
    case 'model': base.modelBreakdown = d.modelBreakdown; break
    case 'trim': base.trimBreakdown = d.trimBreakdown; break
    case 'condition': base.conditionBreakdown = d.conditionBreakdown; break
    case 'conversionType': base.conversionBreakdown = d.conversionBreakdown; break
    case 'color': base.colorBreakdown = d.colorBreakdown; break
    case 'rampType': base.wavFeatures.rampTypes = d.wavFeatures.rampTypes; break
    case 'wavFeatures':
      base.wavFeatures.hasLift = d.wavFeatures.hasLift
      base.wavFeatures.handControls = d.wavFeatures.handControls
      break
    case 'state': base.stateBreakdown = d.stateBreakdown; break
    case 'sellerType': base.sellerTypeBreakdown = d.sellerTypeBreakdown; break
    case 'fuelType': base.fuelTypeBreakdown = d.fuelTypeBreakdown; break
    case 'conversionBrand': base.conversionBrandBreakdown = d.conversionBrandBreakdown; break
  }
}

function stabilize(merged: FacetsData, prev: FacetsData | null): FacetsData {
  if (!prev) return merged
  return {
    ...merged,
    makeBreakdown: stabilizeBars(merged.makeBreakdown, prev.makeBreakdown),
    modelBreakdown: stabilizeBars(merged.modelBreakdown, prev.modelBreakdown),
    trimBreakdown: stabilizeBars(merged.trimBreakdown, prev.trimBreakdown),
    conditionBreakdown: stabilizeBars(merged.conditionBreakdown, prev.conditionBreakdown),
    conversionBreakdown: stabilizeBars(merged.conversionBreakdown, prev.conversionBreakdown),
    colorBreakdown: stabilizeBars(merged.colorBreakdown, prev.colorBreakdown),
    stateBreakdown: stabilizeBars(merged.stateBreakdown, prev.stateBreakdown),
    sellerTypeBreakdown: stabilizeBars(merged.sellerTypeBreakdown, prev.sellerTypeBreakdown),
    fuelTypeBreakdown: stabilizeBars(merged.fuelTypeBreakdown, prev.fuelTypeBreakdown),
    conversionBrandBreakdown: stabilizeBars(merged.conversionBrandBreakdown, prev.conversionBrandBreakdown),
    wavFeatures: {
      ...merged.wavFeatures,
      rampTypes: stabilizeBars(merged.wavFeatures.rampTypes, prev.wavFeatures.rampTypes),
    },
  }
}

/**
 * The single owner of categorical facet data for a page. Requests are deduplicated by URL and
 * aborted when the query changes or the owner unmounts, so a stale response cannot overwrite
 * a newer one. Failures keep the last good data and report `unavailable`.
 */
export function useFacetsData({ enabled = true, brands = true }: { enabled?: boolean; brands?: boolean } = {}): FacetsState {
  const searchParams = useSearchParams()
  const [state, setState] = useState<FacetsState>({ data: null, brands: [], status: 'loading', ranges: { price: null, year: null, mileage: null } })
  const prevRef = useRef<FacetsData | null>(null)

  useEffect(() => {
    if (!enabled || !brands) return
    const controller = new AbortController()
    void fetchConversionBrands(controller.signal).then((brands) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, brands }))
    })
    return () => controller.abort()
  }, [enabled, brands])

  const query = searchParams.toString()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const params = new URLSearchParams(query)
    const active = DISJUNCTIVE_PARAMS.filter((p) => (params.get(p) ?? '').split(',').some((v) => v.trim()))
    const baseUrl = buildFacetsUrl(params, null)
    // A range histogram needs its own request only while its range is active; otherwise it shares the base.
    const rangeUrls = RANGE_KINDS.map((kind) => ({ kind, url: buildFacetsUrl(params, RANGE_OMIT[kind]) }))
    const calls = active.map((param) => ({ param, url: buildFacetsUrl(params, param) }))

    // Deduplicate: identical URLs share one request.
    const inflight = new Map<string, Promise<FacetsData>>()
    const request = (url: string) => {
      const existing = inflight.get(url)
      if (existing) return existing
      const created = fetchFacets(url, controller.signal)
      inflight.set(url, created)
      return created
    }

    setState((s) => (s.status === 'unavailable' ? { ...s, status: 'loading' } : s))
    void (async () => {
      try {
        const [base, ...all] = await Promise.all([request(baseUrl), ...calls.map(({ url }) => request(url)), ...rangeUrls.map(({ url }) => request(url))])
        const rest = all.slice(0, calls.length)
        const rangeData = all.slice(calls.length)
        if (controller.signal.aborted || !base) return
        const merged: FacetsData = { ...base, wavFeatures: { ...base.wavFeatures } }
        rest.forEach((d, i) => mergeDisjunctive(merged, calls[i]!.param, d))
        const stabilized = stabilize(merged, prevRef.current)
        prevRef.current = merged
        const ranges = Object.fromEntries(rangeUrls.map(({ kind }, i) => [kind, rangeData[i] ?? null])) as Record<RangeKind, FacetsData | null>
        setState((s) => ({ ...s, data: stabilized, ranges, status: 'ready' }))
      } catch {
        if (!controller.signal.aborted) setState((s) => ({ ...s, status: 'unavailable' }))
      }
    })()
    return () => controller.abort()
  }, [query, enabled])

  return state
}

/** Lets histograms read the page's single facet owner instead of fetching their own range data. */
export const FacetsStateContext = createContext<FacetsState | null>(null)

/** Cross-filtered range data for one histogram: shared owner when present, otherwise its own small owner. */
export function useRangeFacets(kind: RangeKind): FacetsData | null {
  const shared = useContext(FacetsStateContext)
  const own = useFacetsData({ enabled: shared === null, brands: false })
  return (shared ?? own).ranges[kind]
}
