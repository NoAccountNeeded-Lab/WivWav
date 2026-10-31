'use client'

import { useCallback, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { PriceHistogram } from './PriceHistogram'
import { YearHistogram } from './YearHistogram'
import { MileageHistogram } from './MileageHistogram'
import { FilterGroup } from './filters/FilterGroup'
import type { CategoricalRendererType } from './filters/types'
import { toggleMembers } from '@/lib/color-families'
import { parseCommaSep, useFacetGroups } from './use-facet-groups'
import { useFacetsData } from './use-facets-data'
import type { FacetsState } from './use-facets-data'
import styles from './CategoryBarChart.module.css'

const StateHeatMap = dynamic(() => import('./StateHeatMap'), { ssr: false })

/** Per-group renderer overrides. Keys are group ids: make, model, condition, entry, color, state, features. */
export type RendererMap = Partial<Record<string, CategoricalRendererType>>

interface CategoryBarChartProps {
  showMap?: boolean
  showHistograms?: boolean
  /** When provided, only these group ids (and 'features') are rendered. */
  limitGroups?: string[]
  /** Disables the internal multi-column layout so groups fill their container. */
  singleColumn?: boolean
  /** Per-group renderer overrides. Defaults to 'bars' for all groups. */
  renderers?: RendererMap
  /** Facet data from a page-level owner. When omitted, this component owns its own request. */
  facets?: FacetsState
}

export function CategoryBarChart(props: CategoryBarChartProps) {
  return props.facets ? <CategoryBarChartView {...props} facets={props.facets} /> : <OwnedCategoryBarChart {...props} />
}

function OwnedCategoryBarChart(props: CategoryBarChartProps) {
  const facets = useFacetsData()
  return <CategoryBarChartView {...props} facets={facets} />
}

function CategoryBarChartView({
  showMap = true,
  showHistograms = true,
  limitGroups,
  singleColumn = false,
  renderers = {},
  facets,
}: CategoryBarChartProps & { facets: FacetsState }) {
  const t = useTranslations('FilterControls')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const { groups, featureItems, unavailable, toggleFeature } = useFacetGroups(facets, searchParams)
  const data = facets.data

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
    (param: string, value: string, members?: string[]) => {
      const current = parseCommaSep(searchParams.get(param))
      const next = toggleMembers(current, value, members)
      push({ [param]: next.length ? next.join(',') : null })
    },
    [push, searchParams],
  )

  const handleFeatureToggle = (value: string) => toggleArray(toggleFeature(value).param, value)
  const unavailableText = unavailable ? t('countsUnavailable') : undefined

  const visibleGroups = limitGroups
    ? groups.filter((g) => limitGroups.includes(g.id))
    : groups

  const showFeatures = !limitGroups || limitGroups.includes('features')

  const rendererFor = (id: string): CategoricalRendererType => renderers[id] ?? 'bars'

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
              onToggle={(v) => toggleArray(groups[0]!.param, v, groups[0]!.members?.[v])}
              renderer={rendererFor(groups[0].id)}
              unavailableText={unavailableText}
            />
          )}
          <YearHistogram />
          {groups[1] && (
            <FilterGroup
              key={groups[1].id}
              title={groups[1].title}
              labelId={`cat-bar-${groups[1].id}`}
              items={groups[1].items}
              onToggle={(v) => toggleArray(groups[1]!.param, v, groups[1]!.members?.[v])}
              renderer={rendererFor(groups[1].id)}
              unavailableText={unavailableText}
            />
          )}
          <MileageHistogram />
          {groups.slice(2).map((g) => (
            <FilterGroup
              key={g.id}
              title={g.title}
              labelId={`cat-bar-${g.id}`}
              items={g.items}
              onToggle={(v) => toggleArray(g.param, v, g.members?.[v])}
              renderer={rendererFor(g.id)}
            unavailableText={unavailableText}
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
            onToggle={(v) => toggleArray(g.param, v, g.members?.[v])}
            renderer={rendererFor(g.id)}
            unavailableText={unavailableText}
          />
        ))
      )}

      {showFeatures && (unavailable || featureItems.some((i) => !i.disabled || i.active)) && (
        <FilterGroup
          title={t('groups.features')}
          labelId="cat-bar-features"
          items={featureItems}
          onToggle={handleFeatureToggle}
          renderer={rendererFor('features')}
          unavailableText={unavailableText}
        />
      )}
    </div>
  )
}
