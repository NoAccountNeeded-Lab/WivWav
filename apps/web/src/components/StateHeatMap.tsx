'use client'

import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import type { BarDatum } from './category-facets'
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

export interface StateHeatMapProps {
  /** Per-state listing counts for the current filter query (state abbreviation + count). */
  data: BarDatum[]
  /** Currently active `state` filter values (abbreviations). */
  activeStates: string[]
  /** Invoked with a state abbreviation when a state is clicked/activated via keyboard. */
  onToggle: (abbreviation: string) => void
}

function countLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'listing' : 'listings'}`
}

/** Sequential single-hue scale: 0 counts stay neutral, higher counts saturate toward the brand primary. */
function fillFor(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) return 'var(--clr-surface)'
  const pct = Math.round(15 + (count / maxCount) * 85)
  return `color-mix(in srgb, var(--clr-primary) ${pct}%, var(--clr-surface))`
}

export default function StateHeatMap({ data, activeStates, onToggle }: StateHeatMapProps) {
  const [hovered, setHovered] = useState<HoveredState | null>(null)
  const statusId = useId()

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

  const handleKeyDown = (abbr: string) => (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(abbr)
    }
  }

  return (
    <div className={styles.root}>
      {/* role="img" would mark this subtree presentational and hide the
          per-state role="button" controls below from the accessibility
          tree entirely, even though they stay keyboard-focusable — so this
          is a labelled group of interactive controls, not a static image. */}
      <ComposableMap
        projection="geoAlbersUsa"
        className={styles.map}
        role="group"
        aria-label="Map of the United States shaded by number of matching listings per state"
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
              const fill = fillFor(count, maxCount)

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  tabIndex={0}
                  role="button"
                  aria-pressed={active}
                  aria-label={`${name}: ${countLabel(count)}${active ? ', selected' : ''}`}
                  className={styles.state}
                  data-active={active}
                  style={{ default: { fill }, hover: { fill }, pressed: { fill } }}
                  onClick={() => onToggle(abbr)}
                  onKeyDown={handleKeyDown(abbr)}
                  onMouseEnter={() => setHovered({ name, count })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ name, count })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${name}: ${countLabel(count)}`}</title>
                </Geography>
              )
            })
          }
        </Geographies>
      </ComposableMap>

      <div id={statusId} className={styles.status} aria-live="polite">
        {hovered ? `${hovered.name}: ${countLabel(hovered.count)}` : 'Hover or select a state to see listing counts'}
      </div>

      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendLabel}>Fewer</span>
        <span
          className={styles.legendBar}
          style={{
            background: `linear-gradient(to right, var(--clr-surface), color-mix(in srgb, var(--clr-primary) 100%, var(--clr-surface)))`,
          }}
        />
        <span className={styles.legendLabel}>More</span>
      </div>
    </div>
  )
}
