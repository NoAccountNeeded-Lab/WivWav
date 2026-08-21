'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { PriceHistogram } from './PriceHistogram'
import { YearHistogram } from './YearHistogram'
import { MileageHistogram } from './MileageHistogram'
import { FilterGroup } from './filters/FilterGroup'
import type { FilterItem, CategoricalRendererType } from './filters/types'
import { formatFilterLabel } from './filters/types'
import { normalizeFacetsData } from './category-facets'
import type { BarDatum, FacetsData } from './category-facets'
import { getClientApiBaseUrl } from '@/lib/api-url'
import styles from './CategoryBarChart.module.css'

const StateHeatMap = dynamic(() => import('./StateHeatMap'), { ssr: false })

// ── Types ──────────────────────────────────────────────────────────────────

interface ConversionBrandSummary {
  id: string
  name: string
  slug: string
  productCount: number
}

// ── Disjunctive faceting config ────────────────────────────────────────────

const DISJUNCTIVE_PARAMS = ['make', 'model', 'trim', 'condition', 'conversionType', 'color', 'rampType', 'wavFeatures', 'state', 'sellerType', 'fuelType', 'conversionBrand'] as const
type DisjunctiveParam = typeof DISJUNCTIVE_PARAMS[number]

const ALL_FILTER_PARAMS = [
  'q', 'make', 'model', 'trim', 'yearMin', 'yearMax', 'priceMin', 'priceMax',
  'mileageMax', 'condition', 'conversionType', 'rampType', 'wavFeatures',
  'conversionBrand', 'color', 'state', 'sellerType', 'fuelType',
]

const MAX_BARS = 8

// ── Helpers ────────────────────────────────────────────────────────────────

function buildFacetsUrl(
  searchParams: { get: (key: string) => string | null },
  omitParam: string | null,
): string {
  const base = getClientApiBaseUrl()
  const url = new URL(`${base}/v1/listings/facets`)
  for (const key of ALL_FILTER_PARAMS) {
    if (key === omitParam) continue
    const val = searchParams.get(key)
    if (val) url.searchParams.set(key, val)
  }
  return url.toString()
}

function parseCommaSep(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

async function fetchFacets(url: string): Promise<FacetsData> {
  const res = await fetch(url)
  const json = (await res.json()) as { data: unknown }
  return normalizeFacetsData(json.data)
}

async function fetchConversionBrands(): Promise<ConversionBrandSummary[]> {
  const base = getClientApiBaseUrl()
  try {
    const res = await fetch(`${base}/v1/conversion-brands`)
    if (!res.ok) return []
    const json = (await res.json()) as { data?: ConversionBrandSummary[] }
    return json.data ?? []
  } catch {
    return []
  }
}

function stabilizeBars(current: BarDatum[], previous: BarDatum[]): BarDatum[] {
  const currentSet = new Set(current.map((b) => b.value))
  const ghost = previous
    .filter((b) => !currentSet.has(b.value))
    .map((b) => ({ value: b.value, count: 0 }))
    .slice(0, MAX_BARS)
  return [...current, ...ghost]
}

/** Convert BarDatum[] + active values into the normalized FilterItem[] the renderers expect. */
function toFilterItems(bars: BarDatum[], activeValues: string[]): FilterItem[] {
  return bars.map((b) => ({
    value: b.value,
    label: formatFilterLabel(b.value),
    count: b.count,
    active: activeValues.includes(b.value),
    disabled: b.count === 0 && !activeValues.includes(b.value),
  }))
}

// ── Main component ─────────────────────────────────────────────────────────

/** Per-group renderer overrides. Keys are group ids: make, model, condition, entry, color, state, features. */
export type RendererMap = Partial<Record<string, CategoricalRendererType>>

export function CategoryBarChart({
  showMap = true,
  showHistograms = true,
  limitGroups,
  singleColumn = false,
  renderers = {},
}: {
  showMap?: boolean
  showHistograms?: boolean
  /** When provided, only these group ids (and 'features') are rendered. */
  limitGroups?: string[]
  /** Disables the internal multi-column layout so groups fill their container. */
  singleColumn?: boolean
  /** Per-group renderer overrides. Defaults to 'bars' for all groups. */
  renderers?: RendererMap
}) {
  const t = useTranslations('FilterControls')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [data, setData] = useState<FacetsData | null>(null)
  const [conversionBrands, setConversionBrands] = useState<ConversionBrandSummary[]>([])
  const prevFacetsRef = useRef<FacetsData | null>(null)

  useEffect(() => {
    let cancelled = false

    const doFetch = async () => {
      const brands = await fetchConversionBrands()
      if (!cancelled) setConversionBrands(brands)
    }

    void doFetch()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    const activeDisjunctive = DISJUNCTIVE_PARAMS.filter(
      (p) => parseCommaSep(searchParams.get(p)).length > 0,
    )

    const baseUrl = buildFacetsUrl(searchParams, null)
    const disjunctiveCalls = activeDisjunctive.map((param) => ({
      param,
      url: buildFacetsUrl(searchParams, param),
    }))

    const doFetch = async () => {
      try {
        const [base, ...disjResults] = await Promise.all([
          fetchFacets(baseUrl),
          ...disjunctiveCalls.map(({ url }) => fetchFacets(url)),
        ])

        if (cancelled || !base) return

        const merged: FacetsData = { ...base, wavFeatures: { ...base.wavFeatures } }

        disjResults.forEach((d, i) => {
          const param = disjunctiveCalls[i]!.param as DisjunctiveParam
          switch (param) {
            case 'make':           merged.makeBreakdown = d.makeBreakdown; break
            case 'model':          merged.modelBreakdown = d.modelBreakdown; break
            case 'trim':           merged.trimBreakdown = d.trimBreakdown; break
            case 'condition':      merged.conditionBreakdown = d.conditionBreakdown; break
            case 'conversionType': merged.conversionBreakdown = d.conversionBreakdown; break
            case 'color':          merged.colorBreakdown = d.colorBreakdown; break
            case 'rampType':       merged.wavFeatures.rampTypes = d.wavFeatures.rampTypes; break
            case 'wavFeatures':
              merged.wavFeatures.hasLift = d.wavFeatures.hasLift
              merged.wavFeatures.handControls = d.wavFeatures.handControls
              break
            case 'state':          merged.stateBreakdown = d.stateBreakdown; break
            case 'sellerType':     merged.sellerTypeBreakdown = d.sellerTypeBreakdown; break
            case 'fuelType':       merged.fuelTypeBreakdown = d.fuelTypeBreakdown; break
            case 'conversionBrand': merged.conversionBrandBreakdown = d.conversionBrandBreakdown; break
          }
        })

        const prev = prevFacetsRef.current
        const stabilized: FacetsData = prev
          ? {
              ...merged,
              makeBreakdown:       stabilizeBars(merged.makeBreakdown,       prev.makeBreakdown),
              modelBreakdown:      stabilizeBars(merged.modelBreakdown,      prev.modelBreakdown),
              trimBreakdown:       stabilizeBars(merged.trimBreakdown,       prev.trimBreakdown),
              conditionBreakdown:  stabilizeBars(merged.conditionBreakdown,  prev.conditionBreakdown),
              conversionBreakdown: stabilizeBars(merged.conversionBreakdown, prev.conversionBreakdown),
              colorBreakdown:      stabilizeBars(merged.colorBreakdown,      prev.colorBreakdown),
              stateBreakdown:      stabilizeBars(merged.stateBreakdown,      prev.stateBreakdown),
              sellerTypeBreakdown: stabilizeBars(merged.sellerTypeBreakdown, prev.sellerTypeBreakdown),
              fuelTypeBreakdown: stabilizeBars(merged.fuelTypeBreakdown, prev.fuelTypeBreakdown),
              conversionBrandBreakdown: stabilizeBars(merged.conversionBrandBreakdown, prev.conversionBrandBreakdown),
              wavFeatures: {
                ...merged.wavFeatures,
                rampTypes: stabilizeBars(merged.wavFeatures.rampTypes, prev.wavFeatures.rampTypes),
              },
            }
          : merged

        prevFacetsRef.current = merged
        setData(stabilized)
      } catch {
        // silent — chart stays at last known state
      }
    }

    void doFetch()
    return () => { cancelled = true }
  }, [searchParams])

  // ── URL mutation helpers ─────────────────────────────────────────────────

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      params.delete('page')
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false })
      })
    },
    [router, pathname, searchParams],
  )

  const toggleArray = useCallback(
    (param: string, value: string) => {
      const current = parseCommaSep(searchParams.get(param))
      const next = toggleInList(current, value)
      push({ [param]: next.length ? next.join(',') : null })
    },
    [push, searchParams],
  )

  // ── Build group definitions ──────────────────────────────────────────────

  // Facet values are raw scraper slugs; only the curated /v1/conversion-brands
  // list is trustworthy enough to display (the index also holds noise values
  // like "yes" or "fr"). It doubles as the display-name source ("BraunAbility",
  // not "Braunability").
  const brandNameBySlug = new Map(conversionBrands.map((b) => [b.slug, b.name]))
  const brandItems = data
    ? toFilterItems(
        data.conversionBrandBreakdown.filter((b) => brandNameBySlug.has(b.value)),
        parseCommaSep(searchParams.get('conversionBrand')),
      ).map((item) => ({ ...item, label: brandNameBySlug.get(item.value) ?? item.label }))
    : []

  const groups: Array<{
    id: string
    title: string
    items: FilterItem[]
    param: string
  }> = data ? [
    { id: 'make',      title: t('groups.make'),      items: toFilterItems(data.makeBreakdown,                                               parseCommaSep(searchParams.get('make'))),           param: 'make'           },
    { id: 'model',     title: t('groups.model'),     items: toFilterItems(data.modelBreakdown,                                              parseCommaSep(searchParams.get('model'))),          param: 'model'          },
    { id: 'trim',      title: t('groups.trim'),      items: toFilterItems(data.trimBreakdown,                                               parseCommaSep(searchParams.get('trim'))),           param: 'trim'           },
    { id: 'condition', title: t('groups.condition'), items: toFilterItems(data.conditionBreakdown,                                          parseCommaSep(searchParams.get('condition'))),      param: 'condition'      },
    { id: 'entry',     title: t('groups.entry'),     items: toFilterItems(data.conversionBreakdown.filter((b) => b.value !== 'unknown'),    parseCommaSep(searchParams.get('conversionType'))), param: 'conversionType' },
    { id: 'conversionBrand', title: t('groups.conversionBrand'), items: brandItems,                                                                                                             param: 'conversionBrand' },
    { id: 'color',     title: t('groups.color'),     items: toFilterItems(data.colorBreakdown,                                              parseCommaSep(searchParams.get('color'))),          param: 'color'          },
    { id: 'state',     title: t('groups.state'),     items: toFilterItems(data.stateBreakdown,                                              parseCommaSep(searchParams.get('state'))),          param: 'state'          },
    { id: 'seller',    title: t('groups.seller'),    items: toFilterItems(data.sellerTypeBreakdown,                                         parseCommaSep(searchParams.get('sellerType'))),     param: 'sellerType'     },
    { id: 'fuelType',  title: t('groups.fuelType'),  items: toFilterItems(data.fuelTypeBreakdown,                                           parseCommaSep(searchParams.get('fuelType'))),       param: 'fuelType'       },
  ].filter((g) => g.items.length > 0) : []

  const activeWavFeatures = parseCommaSep(searchParams.get('wavFeatures'))
  const activeRampTypes = parseCommaSep(searchParams.get('rampType'))

  const featureItems: FilterItem[] = data ? [
    {
      value: 'has_lift',
      label: t('features.hasLift'),
      count: data.wavFeatures.hasLift,
      active: activeWavFeatures.includes('has_lift'),
      disabled: data.wavFeatures.hasLift === 0 && !activeWavFeatures.includes('has_lift'),
    },
    {
      value: 'hand_controls',
      label: t('features.handControls'),
      count: data.wavFeatures.handControls,
      active: activeWavFeatures.includes('hand_controls'),
      disabled: data.wavFeatures.handControls === 0 && !activeWavFeatures.includes('hand_controls'),
    },
    ...data.wavFeatures.rampTypes
      .filter((r) => r.value !== 'unknown' && r.value !== 'none')
      .map((r) => ({
        value: r.value,
        label: formatFilterLabel(r.value),
        count: r.count,
        active: activeRampTypes.includes(r.value),
        disabled: r.count === 0 && !activeRampTypes.includes(r.value),
      })),
  ] : []

  const handleFeatureToggle = (value: string) => {
    if (value === 'has_lift' || value === 'hand_controls') {
      toggleArray('wavFeatures', value)
      return
    }
    toggleArray('rampType', value)
  }

  const visibleGroups = limitGroups
    ? groups.filter((g) => limitGroups.includes(g.id))
    : groups

  const showFeatures = !limitGroups || limitGroups.includes('features')

  const r = (id: string): CategoricalRendererType => renderers[id] ?? 'bars'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`${styles.root}${singleColumn ? ` ${styles.singleColumn}` : ''}`}>
      {showMap && (
        <div className={`${styles.mapGroup}`}>
          <span className={styles.mapTitle}>{t('groups.location')}</span>
          <div className={styles.mapContainer}>
            <StateHeatMap
              data={data?.stateBreakdown ?? []}
              activeStates={parseCommaSep(searchParams.get('state'))}
              onToggle={(value) => toggleArray('state', value)}
            />
          </div>
        </div>
      )}

      {showHistograms ? (
        <>
          <PriceHistogram />
          {groups[0] && (
            <FilterGroup
              key={groups[0].id}
              title={groups[0].title}
              labelId={`cat-bar-${groups[0].id}`}
              items={groups[0].items}
              onToggle={(v) => toggleArray(groups[0]!.param, v)}
              renderer={r(groups[0].id)}
            />
          )}
          <YearHistogram />
          {groups[1] && (
            <FilterGroup
              key={groups[1].id}
              title={groups[1].title}
              labelId={`cat-bar-${groups[1].id}`}
              items={groups[1].items}
              onToggle={(v) => toggleArray(groups[1]!.param, v)}
              renderer={r(groups[1].id)}
            />
          )}
          <MileageHistogram />
          {groups.slice(2).map((g) => (
            <FilterGroup
              key={g.id}
              title={g.title}
              labelId={`cat-bar-${g.id}`}
              items={g.items}
              onToggle={(v) => toggleArray(g.param, v)}
              renderer={r(g.id)}
            />
          ))}
        </>
      ) : (
        visibleGroups.map((g) => (
          <FilterGroup
            key={g.id}
            title={g.title}
            labelId={`cat-bar-${g.id}`}
            items={g.items}
            onToggle={(v) => toggleArray(g.param, v)}
            renderer={r(g.id)}
          />
        ))
      )}

      {showFeatures && featureItems.some((i) => !i.disabled || i.active) && (
        <FilterGroup
          title={t('groups.features')}
          labelId="cat-bar-features"
          items={featureItems}
          onToggle={handleFeatureToggle}
          renderer={r('features')}
        />
      )}
    </div>
  )
}
