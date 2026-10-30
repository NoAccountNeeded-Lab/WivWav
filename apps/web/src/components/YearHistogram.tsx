'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Slider } from '@/components/ui/slider'
import { parsePositiveIntegerParameter, rangeFilterSearchParams, useStableRangeValue } from '@/components/useStableRangeValue'
import { getClientApiBaseUrl } from '@/lib/api-url'
import styles from './PriceHistogram.module.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface YearDatum {
  year: number
  count: number
}

// Omit year params so this histogram shows cross-filtered data (all years visible)
const FORWARD_PARAMS = [
  'q', 'make', 'model', 'priceMin', 'priceMax', 'mileageMax',
  'condition', 'conversionType', 'rampType', 'wavFeatures', 'color', 'state', 'sellerType', 'fuelType',
  'conversionBrand',
]

// ── Custom tooltip ─────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: YearDatum }>
  formatListingCount: (count: number) => string
}

function YearTooltip({ active, payload, formatListingCount }: TooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className={styles.tooltip}>
      <span className={styles.tooltipRange}>{d.year}</span>
      <span className={styles.tooltipCount}>{formatListingCount(d.count)}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function YearHistogram({ renderer: _renderer = 'histogram' }: { renderer?: 'histogram' } = {}) {
  const t = useTranslations('FilterControls')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlMin = useMemo(() => {
    const v = searchParams.get('yearMin')
    return parsePositiveIntegerParameter(v)
  }, [searchParams])

  const urlMax = useMemo(() => {
    const v = searchParams.get('yearMax')
    return parsePositiveIntegerParameter(v)
  }, [searchParams])

  const [data, setData] = useState<YearDatum[]>([])
  const [rangeMin, setRangeMin] = useState(2000)
  const [rangeMax, setRangeMax] = useState(new Date().getFullYear())
  const hasFilter = urlMin > 0 || urlMax > 0

  const fetchUrl = useMemo(() => {
    const base = getClientApiBaseUrl()
    const url = new URL(`${base}/v1/listings/facets`)
    for (const key of FORWARD_PARAMS) {
      const val = searchParams.get(key)
      if (val) url.searchParams.set(key, val)
    }
    return url.toString()
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    fetch(fetchUrl)
      .then((r) => r.json() as Promise<{ data: { yearDistribution: YearDatum[] } }>)
      .then(({ data: { yearDistribution } }) => {
        if (cancelled || !yearDistribution.length) return
        setData(yearDistribution)
        const years = yearDistribution.map((d) => d.year)
        setRangeMin(Math.min(...years))
        setRangeMax(Math.max(...years))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [fetchUrl])

  const push = useCallback(
    (min: number, max: number, baseSearchParams?: string) => {
      const params = rangeFilterSearchParams(baseSearchParams ?? searchParams.toString(), baseSearchParams !== undefined)
      if (min > 0 && min > rangeMin) {
        params.set('yearMin', String(min))
      } else {
        params.delete('yearMin')
      }
      if (max > 0 && max < rangeMax) {
        params.set('yearMax', String(max))
      } else {
        params.delete('yearMax')
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams, rangeMin, rangeMax],
  )

  const reapplyCommit = useCallback(
    ([min, max]: readonly [number, number], baseSearchParams?: string) => push(min, max, baseSearchParams),
    [push],
  )
  const readHistoryValue = useCallback((search: string) => {
    const params = new URLSearchParams(search)
    const min = parsePositiveIntegerParameter(params.get('yearMin'))
    const max = parsePositiveIntegerParameter(params.get('yearMax'))
    return {
      range: [min, max] as const,
      searchParams: params.toString(),
    }
  }, [rangeMin, rangeMax])
  const stableRange = useStableRangeValue([urlMin, urlMax], [rangeMin, rangeMax], reapplyCommit, readHistoryValue)
  const [displayMin, displayMax] = stableRange.value

  const handleBarClick = useCallback(
    (d: YearDatum) => {
      const alreadyActive = hasFilter && displayMin === d.year && displayMax === d.year
      if (alreadyActive) {
        stableRange.handleCommit([rangeMin, rangeMax], [0, 0])
        push(0, 0)
      } else {
        const min = d.year <= rangeMin ? 0 : d.year
        const max = d.year >= rangeMax ? 0 : d.year
        stableRange.handleCommit([d.year, d.year], [min, max])
        push(d.year, d.year)
      }
    },
    [hasFilter, displayMin, displayMax, rangeMin, rangeMax, stableRange.handleCommit, push],
  )

  const handleSliderChange = stableRange.handleChange

  const handleSliderCommit = useCallback(
    (v: number[]) => {
      if (v.length >= 2) {
        const min = v[0]! <= rangeMin ? 0 : v[0]!
        const max = v[1]! >= rangeMax ? 0 : v[1]!
        stableRange.handleCommit(v, [min, max])
        push(v[0]!, v[1]!)
      }
    },
    [push, rangeMin, rangeMax, stableRange.handleCommit],
  )

  const isBarActive = useCallback(
    (d: YearDatum): boolean => {
      if (displayMin <= rangeMin && displayMax >= rangeMax) return true
      return d.year >= displayMin && d.year <= displayMax
    },
    [displayMin, displayMax, rangeMin, rangeMax],
  )

  const matchingCount = useMemo(() => {
    if (!data.length) return null
    return data
      .filter((d) => d.year >= displayMin && d.year <= displayMax)
      .reduce((sum, d) => sum + d.count, 0)
  }, [data, displayMin, displayMax])

  const ariaLabel = useMemo(() => {
    return hasFilter
      ? t('year.ariaFiltered', { min: displayMin, max: displayMax })
      : t('year.ariaUnfiltered')
  }, [hasFilter, displayMin, displayMax, t])

  const formatListingCount = useCallback((count: number) => t('listingCount', { count }), [t])

  if (!data.length) return null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>{t('year.label')}</span>
      </div>

      <div className={styles.chartWrapper} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="10%">
            <Tooltip content={<YearTooltip formatListingCount={formatListingCount} />} cursor={{ fill: 'var(--clr-border)', opacity: 0.5 }} />
            <Bar
              dataKey="count"
              radius={[2, 2, 0, 0]}
              onClick={(d) => handleBarClick(d as unknown as YearDatum)}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.year}
                  fill={isBarActive(entry) ? 'var(--clr-primary)' : 'var(--clr-border-strong)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.sliderWrapper}>
        <Slider
          min={rangeMin}
          max={rangeMax}
          step={1}
          value={[displayMin, displayMax]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          aria-label={t('year.rangeLabel')}
          className={styles.slider}
        />
      </div>

      <div className={styles.sliderLabels}>
        <span className={styles.sliderLow}>{displayMin}</span>
        {matchingCount !== null && (
          <span className={styles.sliderCount}>
            {t('listingCount', { count: matchingCount })}
          </span>
        )}
        <span className={styles.sliderHigh}>{displayMax}</span>
      </div>
    </div>
  )
}
