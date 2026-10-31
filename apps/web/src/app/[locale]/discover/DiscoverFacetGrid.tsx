'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { MileageHistogram } from '@/components/MileageHistogram'
import { PriceHistogram } from '@/components/PriceHistogram'
import { YearHistogram } from '@/components/YearHistogram'
import { FilterGroup } from '@/components/filters/FilterGroup'
import { ChipsRenderer } from '@/components/filters/ChipsRenderer'
import { FILTER_RENDERERS } from '@/components/filters/renderer-defaults'
import { parseCommaSep, useFacetGroups } from '@/components/use-facet-groups'
import { FacetsStateContext, useFacetsData } from '@/components/use-facets-data'
import { toggleMembers } from '@/lib/color-families'
import { US_STATE_NAME_TO_ABBR } from '@/lib/us-states'
import styles from './DiscoverFacetGrid.module.css'

const StateHeatMap = dynamic(() => import('@/components/StateHeatMap'), { ssr: false })

const STATE_PARAM = 'state'
const DEFAULT_RENDERER = 'bars'
const STATE_NAME_BY_ABBR = new Map(Object.entries(US_STATE_NAME_TO_ABBR).map(([name, abbr]) => [abbr, name]))

/**
 * DOM order is reading order: mobility requirements first, then vehicle, price/year/mileage,
 * location, then secondary attributes. The CSS grid fills rows left to right in this order, so
 * visual and keyboard order agree at every column count.
 */
const ORDER: Array<string> = [
  'entry', 'wheelchairCapacity', 'features', 'conversionBrand', 'conversionStatus',
  '$price', 'make', 'model', 'trim', 'condition', '$year', '$mileage',
  '$location', 'color', 'seller', 'fuelType', 'transmission', 'city',
]

/** One categorical-data owner feeds every facet; histograms keep their own cross-filtered range requests. */
export function DiscoverFacetGrid() {
  const t = useTranslations('FilterControls')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const facets = useFacetsData()
  const { groups, featureItems, unavailable, toggleFeature } = useFacetGroups(facets, searchParams)

  const toggle = (param: string, value: string, members?: string[]) => {
    const current = parseCommaSep(searchParams.get(param))
    const next = toggleMembers(current, value, members)
    const params = new URLSearchParams(searchParams.toString())
    if (next.length) params.set(param, next.join(','))
    else params.delete(param)
    params.delete('page')
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  const unavailableText = unavailable ? t('countsUnavailable') : undefined
  const stateGroup = groups.find((g) => g.id === 'state')
  const stateItems = (stateGroup?.items ?? [])
    .map((item) => ({ ...item, label: STATE_NAME_BY_ABBR.get(item.value.toUpperCase()) ?? item.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const cells: Record<string, ReactNode> = {
    $price: <><PriceHistogram /></>,
    $year: <><YearHistogram /></>,
    $mileage: <><MileageHistogram /></>,
    $location: (
      <>
        <section className={styles.location} aria-labelledby="discover-location">
          <h3 id="discover-location" className={styles.locationTitle}>{t('groups.location')}</h3>
          <StateHeatMap
            data={facets.data?.stateBreakdown ?? []}
            activeStates={parseCommaSep(searchParams.get('state'))}
            onToggle={(value) => toggle(STATE_PARAM, value)}
          />
          {unavailableText && <p className={styles.note}>{unavailableText}</p>}
          <div role="group" aria-label={t('locationByName')} className={styles.stateList}>
            <ChipsRenderer items={stateItems} onToggle={(value) => toggle(STATE_PARAM, value)} maxCount={1} />
          </div>
        </section>
      </>
    ),
    features: featureItems.length > 0 ? (
      <>
        <FilterGroup
          title={t('groups.features')}
          labelId="cat-bar-features"
          items={featureItems}
          onToggle={(value) => toggle(toggleFeature(value).param, value)}
          unavailableText={unavailableText}
        />
      </>
    ) : null,
  }
  for (const group of groups) {
    if (group.id === 'state') continue
    cells[group.id] = (
      <>
        <FilterGroup
          title={group.title}
          labelId={`cat-bar-${group.id}`}
          items={group.items}
          onToggle={(value) => toggle(group.param, value, group.members?.[value])}
          renderer={FILTER_RENDERERS[group.id] ?? DEFAULT_RENDERER}
          moreLabel={group.id === 'color' ? t('moreColors') : undefined}
          unavailableText={unavailableText}
        />
      </>
    )
  }

  return (
    <FacetsStateContext.Provider value={facets}>
    <div className={styles.grid}>
      {ORDER.map((id) => cells[id] ? <div key={id} className={`${styles.slot}${id === '$location' ? ` ${styles.wide}` : ''}`}>{cells[id]}</div> : null)}
    </div>
    </FacetsStateContext.Provider>
  )
}
