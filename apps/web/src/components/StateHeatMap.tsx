'use client'

import type { FocusEvent, MouseEvent } from 'react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { useTranslations } from 'next-intl'
import type { BarDatum } from './category-facets'
import { focusVisible } from './filters/FacetTooltip'
import { US_STATE_NAME_TO_ABBR, US_TERRITORY_ABBREVIATIONS } from '@/lib/us-states'
import styles from './StateHeatMap.module.css'

const GEO_URL = '/data/us-states-10m.json'

interface StateGeography {
  rsmKey: string
  properties: { name: string }
}

interface HoveredState {
  name: string
  count: number
}

interface TipState extends HoveredState {
  x: number
  y: number
}

const HOVER_DELAY_MS = 150

export interface StateHeatMapProps {
  /** Per-state listing counts for the current filter query (state abbreviation + count). */
  data: BarDatum[]
  /** Currently active `state` filter values (abbreviations). */
  activeStates: string[]
  /** Invoked with a state abbreviation when a state is clicked/activated via keyboard. */
  onToggle: (abbreviation: string) => void
}

/** Sequential single-hue scale: 0 counts stay neutral, higher counts saturate toward the brand primary. */
function fillFor(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) return 'var(--clr-surface)'
  const pct = Math.round(15 + (count / maxCount) * 85)
  return `color-mix(in srgb, var(--clr-primary) ${pct}%, var(--clr-surface))`
}

export default function StateHeatMap({ data, activeStates, onToggle }: StateHeatMapProps) {
  const [hovered, setHovered] = useState<HoveredState | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusId = useId()
  const t = useTranslations('StateHeatMap')
  const countLabel = (count: number): string => t('listingCount', { count })

  const countsByAbbr = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of data) map.set(d.value.toUpperCase(), d.count)
    return map
  }, [data])

  const maxCount = useMemo(() => data.reduce((max, d) => Math.max(max, d.count), 0), [data])

  const activeSet = useMemo(
    () => new Set(activeStates.map((s) => s.toUpperCase())),
    [activeStates],
  )

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])
  const hideTip = () => { clearTimer(); setTip(null) }
  // Anchor in root-relative px; pointer position for hover, element center for keyboard focus.
  const place = (name: string, count: number, clientX: number, clientY: number) => {
    const box = rootRef.current?.getBoundingClientRect()
    return { name, count, x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) }
  }

  const handleKeyDown = (abbr: string) => (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(abbr)
    }
  }

  return (
    <div role="presentation" className={styles.root} ref={rootRef} onKeyDown={(event) => { if (event.key === 'Escape') hideTip() }}>
      {/* role="img" would mark this subtree presentational and hide the
          per-state role="button" controls below from the accessibility
          tree entirely, even though they stay keyboard-focusable — so this
          is a labelled group of interactive controls, not a static image. */}
      <ComposableMap
        projection="geoAlbersUsa"
        className={styles.map}
        role="group"
        aria-label={t('mapLabel')}
        aria-describedby={statusId}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: StateGeography[] }) =>
            geographies.map((geo) => {
              const name = geo.properties.name
              const abbr = US_STATE_NAME_TO_ABBR[name]

              if (!abbr || US_TERRITORY_ABBREVIATIONS.has(abbr)) {
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    className={styles.territory}
                    tabIndex={-1}
                    focusable={false}
                    aria-hidden="true"
                  />
                )
              }

              const count = countsByAbbr.get(abbr) ?? 0
              const active = activeSet.has(abbr)
              const isMaxCount = count > 0 && count === maxCount
              const fill = fillFor(count, maxCount)

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  tabIndex={0}
                  role="button"
                  aria-pressed={active}
                  aria-label={`${name}: ${countLabel(count)}${active ? t('selected') : ''}`}
                  className={styles.state}
                  data-active={active}
                  data-max-count={isMaxCount}
                  style={{ default: { fill }, hover: { fill }, pressed: { fill } }}
                  onClick={() => onToggle(abbr)}
                  onKeyDown={handleKeyDown(abbr)}
                  onMouseEnter={(event: MouseEvent) => {
                    setHovered({ name, count })
                    clearTimer()
                    const { clientX, clientY } = event
                    timer.current = setTimeout(() => setTip(place(name, count, clientX, clientY)), HOVER_DELAY_MS)
                  }}
                  onPointerLeave={() => { setHovered(null); hideTip() }}
                  onTouchEnd={() => { setHovered(null); hideTip() }}
                  onFocus={(event: FocusEvent) => {
                    // Keyboard focus only; the control's aria-label is its one announcement.
                    if (!focusVisible(event)) return
                    clearTimer()
                    const rect = (event.currentTarget as Element).getBoundingClientRect()
                    setTip(place(name, count, rect.left + rect.width / 2, rect.top))
                  }}
                  onBlur={hideTip}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {tip && (
        <div aria-hidden="true" data-tooltip="" className={styles.tip} style={{ left: tip.x, top: tip.y }}>
          {`${tip.name}: ${countLabel(tip.count)}`}
        </div>
      )}

      <div id={statusId} className={styles.status} aria-live="polite">
        {hovered ? `${hovered.name}: ${countLabel(hovered.count)}` : t('hint')}
      </div>

      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendLabel}>{t('fewer')}</span>
        <span
          className={styles.legendBar}
          style={{
            background: `linear-gradient(to right, var(--clr-surface), color-mix(in srgb, var(--clr-primary) 100%, var(--clr-surface)))`,
          }}
        />
        <span className={styles.legendLabel}>{t('more')}</span>
      </div>
    </div>
  )
}
