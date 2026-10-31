'use client'

import { useTranslations } from 'next-intl'
import { shoppingFilterLabel, SHOPPING_FILTER_PARAMS } from '@/lib/shopping-filter-url'
import type { BarDatum, FacetsData } from './category-facets'
import { normalizeFacetsData } from './category-facets'
import { groupColors } from '@/lib/color-families'
import type { FilterItem } from './filters/types'
import { formatFilterLabel } from './filters/types'
import type { FacetsState } from './use-facets-data'

export interface FacetGroup {
  id: string
  title: string
  items: FilterItem[]
  /** URL query parameter this group toggles. */
  param: string
  /** value -> raw URL values it selects (color families). Absent for ordinary groups. */
  members?: Record<string, string[]>
}

export interface FacetGroups {
  groups: FacetGroup[]
  /** WAV equipment (lift, hand controls) and ramp types, toggled via `toggleFeature`. */
  featureItems: FilterItem[]
  /** True when the data source failed; headings and selected values are still listed. */
  unavailable: boolean
  toggleFeature: (value: string) => { param: string; value: string }
}

export function parseCommaSep(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Convert bars + active values into FilterItem[]; selected values with no count stay as removable zero rows. */
export function toFilterItems(bars: BarDatum[], activeValues: string[]): FilterItem[] {
  const values = new Set(bars.map((bar) => bar.value))
  const withSelected = [...bars, ...activeValues.filter((value) => !values.has(value)).map((value) => ({ value, count: 0 }))]
  return withSelected.map((b) => ({
    value: b.value,
    label: formatFilterLabel(b.value),
    count: b.count,
    active: activeValues.includes(b.value),
    disabled: b.count === 0 && !activeValues.includes(b.value),
  }))
}

type Params = { get: (key: string) => string | null }

/** Derives every categorical facet group from the single data owner's state and the URL. */
export function useFacetGroups(facets: FacetsState, searchParams: Params): FacetGroups {
  const t = useTranslations('FilterControls')
  const unavailable = facets.status === 'unavailable'
  const data: FacetsData | null = facets.data ?? (unavailable ? normalizeFacetsData({}) : null)
  const active = (param: string) => parseCommaSep(searchParams.get(param))

  // Facet values are raw scraper slugs; only the curated /v1/conversion-brands list is trustworthy
  // enough to display (the index also holds noise values like "yes" or "fr").
  const brandNameBySlug = new Map(facets.brands.map((b) => [b.slug, b.name]))
  const brandBars = data
    ? (facets.data ? data.conversionBrandBreakdown.filter((b) => brandNameBySlug.has(b.value)) : [])
    : []

  const colors = groupColors(data?.colorBreakdown ?? [], active('color'))
  const activeWavFeatures = active('wavFeatures')
  const activeRampTypes = active('rampType')

  if (!data) {
    return { groups: [], featureItems: [], unavailable, toggleFeature: (value) => ({ param: 'rampType', value }) }
  }

  const all: FacetGroup[] = [
    { id: 'make', title: t('groups.make'), items: toFilterItems(data.makeBreakdown, active('make')), param: 'make' },
    { id: 'model', title: t('groups.model'), items: toFilterItems(data.modelBreakdown, active('model')), param: 'model' },
    { id: 'trim', title: t('groups.trim'), items: toFilterItems(data.trimBreakdown, active('trim')), param: 'trim' },
    { id: 'condition', title: t('groups.condition'), items: toFilterItems(data.conditionBreakdown, active('condition')), param: 'condition' },
    { id: 'entry', title: t('groups.entry'), items: toFilterItems(data.conversionBreakdown.filter((b) => b.value !== 'unknown'), active('conversionType')), param: 'conversionType' },
    {
      id: 'conversionBrand', title: t('groups.conversionBrand'), param: 'conversionBrand',
      items: toFilterItems(brandBars, active('conversionBrand')).map((item) => ({ ...item, label: brandNameBySlug.get(item.value) ?? item.label })),
    },
    {
      id: 'color', title: t('groups.color'), param: 'color', members: colors.members,
      // A family is selected when any raw color it covers is in the URL.
      items: toFilterItems(colors.bars, Object.entries(colors.members).filter(([, raws]) => raws.some((r) => active('color').includes(r))).map(([family]) => family)),
    },
    { id: 'state', title: t('groups.state'), items: toFilterItems(data.stateBreakdown, active('state')), param: 'state' },
    { id: 'seller', title: t('groups.seller'), items: toFilterItems(data.sellerTypeBreakdown, active('sellerType')), param: 'sellerType' },
    // Shopping filters stay withheld until the index rollout is verified, except to show selected values.
    ...SHOPPING_FILTER_PARAMS.map((param) => ({
      id: param, title: t(`groups.${param}`), param,
      items: toFilterItems(data[`${param}Breakdown`], active(param)).map((item) => ({
        ...item,
        label: param === 'wheelchairCapacity'
          ? t('capacityCount', { count: Number(item.value) })
          : shoppingFilterLabel(param, item.value, (key) => t(`shoppingValues.${key}`)),
      })),
    })).filter((g) => data.shoppingFiltersReady || (unavailable && active(g.param).length > 0)),
    { id: 'fuelType', title: t('groups.fuelType'), items: toFilterItems(data.fuelTypeBreakdown, active('fuelType')), param: 'fuelType' },
  ]
  const groups = unavailable ? all : all.filter((g) => g.items.length > 0)

  const featureItems: FilterItem[] = [
    { value: 'has_lift', label: t('features.hasLift'), count: data.wavFeatures.hasLift, active: activeWavFeatures.includes('has_lift'), disabled: data.wavFeatures.hasLift === 0 && !activeWavFeatures.includes('has_lift') },
    { value: 'hand_controls', label: t('features.handControls'), count: data.wavFeatures.handControls, active: activeWavFeatures.includes('hand_controls'), disabled: data.wavFeatures.handControls === 0 && !activeWavFeatures.includes('hand_controls') },
    ...toFilterItems(data.wavFeatures.rampTypes.filter((r) => r.value !== 'unknown' && r.value !== 'none'), activeRampTypes),
  ]

  return {
    groups,
    featureItems,
    unavailable,
    toggleFeature: (value) => ({ param: value === 'has_lift' || value === 'hand_controls' ? 'wavFeatures' : 'rampType', value }),
  }
}
