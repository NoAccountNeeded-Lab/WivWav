'use client'

import { SHOPPING_FILTER_PARAMS } from '@/lib/shopping-filter-url'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Slider } from '@/components/ui/slider'
import { parsePositiveIntegerParameter, rangeFilterSearchParams, useStableRangeValue } from '@/components/useStableRangeValue'
import { getClientApiBaseUrl } from '@/lib/api-url'
import styles from './PriceHistogram.module.css'

// ── Types ──────────────────────────────────────────────────────────────────

interface RawBucket {
  bucket: string
  count: number
}

interface BucketDatum {
  bucket: string
  lo: number
  hi: number
  count: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BUCKET_SIZE_MILES = 12000
const DEFAULT_MAX = 200000

function parseBucket(raw: string): { lo: number; hi: number } {
  const parts = raw.split('-')
  const lo = parseInt(parts[0] ?? '0', 10)
  const hi = parts[1] !== undefined ? parseInt(parts[1], 10) : lo + BUCKET_SIZE_MILES
  return { lo, hi }
}

function fmtMiles(miles: number): string {
  if (miles === 0) return '0'
  return `${(miles / 1000).toFixed(0)}k`
}

// Omit mileageMax so histogram shows cross-filtered counts (all mileages visible)
const FORWARD_PARAMS = [
  'q', 'make', 'model', 'trim', 'yearMin', 'yearMax', 'priceMin', 'priceMax',
  'condition', 'conversionType', 'rampType', 'wavFeatures', 'color', 'state', 'sellerType', 'fuelType',
  ...SHOPPING_FILTER_PARAMS, 'conversionBrand',
]

// ── Custom tooltip ─────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: BucketDatum }>
  formatListingCount: (count: number) => string
  formatRange: (lo: number, hi: number) => string
}

function MileageTooltip({ active, payload, formatListingCount, formatRange }: TooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className={styles.tooltip}>
      <span className={styles.tooltipRange}>
        {formatRange(d.lo, d.hi)}
      </span>
      <span className={styles.tooltipCount}>{formatListingCount(d.count)}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function MileageHistogram({ renderer: _renderer = 'histogram' }: { renderer?: 'histogram' } = {}) {
  const t = useTranslations('FilterControls')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlMax = useMemo(() => {
    const v = searchParams.get('mileageMax')
    return parsePositiveIntegerParameter(v)
  }, [searchParams])

  const [data, setData] = useState<BucketDatum[]>([])
  const [rangeMax, setRangeMax] = useState(DEFAULT_MAX)
  const [facetsTotal, setFacetsTotal] = useState<number | null>(null)

  const hasFilter = urlMax > 0

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
      .then((r) => r.json() as Promise<{ data: { mileageDistribution: RawBucket[]; total: number } }>)
      .then(({ data: { mileageDistribution, total } }) => {
        if (cancelled || !mileageDistribution.length) return
        const parsed: BucketDatum[] = mileageDistribution.map(({ bucket, count }) => {
          const { lo, hi } = parseBucket(bucket)
          return { bucket, lo, hi, count }
        })
        setData(parsed)
        setFacetsTotal(total)
        setRangeMax(Math.max(...parsed.map((b) => b.hi)))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [fetchUrl])

  const push = useCallback(
    (max: number, baseSearchParams?: string) => {
      const params = rangeFilterSearchParams(baseSearchParams ?? searchParams.toString(), baseSearchParams !== undefined)
      if (max > 0 && max < rangeMax) {
        params.set('mileageMax', String(max))
      } else {
        params.delete('mileageMax')
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams, rangeMax],
  )

  const reapplyCommit = useCallback(
    ([, max]: readonly [number, number], baseSearchParams?: string) => push(max, baseSearchParams),
    [push],
  )
  const readHistoryValue = useCallback((search: string) => {
    const params = new URLSearchParams(search)
    const max = parsePositiveIntegerParameter(params.get('mileageMax'))
    return {
      range: [0, max] as const,
      searchParams: params.toString(),
    }
  }, [rangeMax])
  const stableRange = useStableRangeValue([0, urlMax], [0, rangeMax], reapplyCommit, readHistoryValue)
  const displayMax = stableRange.value[1]

  const handleBarClick = useCallback(
    (d: BucketDatum) => {
      const alreadyActive = hasFilter && displayMax === d.hi
      if (alreadyActive) {
        stableRange.handleCommit([0, rangeMax], [0, 0])
        push(0)
      } else {
        const max = d.hi >= rangeMax ? 0 : d.hi
        stableRange.handleCommit([0, d.hi], [0, max])
        push(d.hi)
      }
    },
    [hasFilter, displayMax, rangeMax, stableRange.handleCommit, push],
  )

  const handleSliderChange = stableRange.handleChange

  const handleSliderCommit = useCallback(
    (v: number[]) => {
      if (v.length >= 1) {
        const max = v[0]! > 0 && v[0]! < rangeMax ? v[0]! : 0
        stableRange.handleCommit(v, [0, max])
        push(v[0]!)
      }
    },
    [push, rangeMax, stableRange.handleCommit],
  )

  const isBarActive = useCallback(
    (d: BucketDatum): boolean => {
      if (displayMax >= rangeMax) return true
      return d.hi <= displayMax
    },
    [displayMax, rangeMax],
  )

  const matchingCount = useMemo(() => {
    if (!data.length) return null
    return data
      .filter((d) => d.hi <= displayMax)
      .reduce((sum, d) => sum + d.count, 0)
  }, [data, displayMax])

  const withoutMileage = useMemo(() => {
    if (facetsTotal === null || !data.length) return null
    const withMileage = data.reduce((sum, d) => sum + d.count, 0)
    const n = facetsTotal - withMileage
    return n > 0 ? n : null
  }, [facetsTotal, data])

  const ariaLabel = useMemo(() => {
    return hasFilter
      ? t('mileage.ariaFiltered', { max: `${fmtMiles(displayMax)}k` })
      : t('mileage.ariaUnfiltered')
  }, [hasFilter, displayMax, t])

  const formatListingCount = useCallback((count: number) => t('listingCount', { count }), [t])

  const formatRange = useCallback(
    (lo: number, hi: number) => t('mileage.range', { lo: fmtMiles(lo), hi: fmtMiles(hi) }),
    [t],
  )

  const highLabel =
    displayMax >= rangeMax
      ? t('mileage.highPlus', { value: fmtMiles(rangeMax) })
      : t('mileage.high', { value: fmtMiles(displayMax) })

  if (!data.length) return null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>{t('mileage.label')}</span>
      </div>

      <div className={styles.chartWrapper} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="10%">
            <Tooltip content={<MileageTooltip formatListingCount={formatListingCount} formatRange={formatRange} />} cursor={{ fill: 'var(--clr-border)', opacity: 0.5 }} />
            <Bar
              dataKey="count"
              radius={[2, 2, 0, 0]}
              onClick={(d) => handleBarClick(d as unknown as BucketDatum)}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.bucket}
                  fill={isBarActive(entry) ? 'var(--clr-primary)' : 'var(--clr-border-strong)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.sliderWrapper}>
        <Slider
          min={0}
          max={rangeMax}
          step={BUCKET_SIZE_MILES}
          value={[displayMax]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          aria-label={t('mileage.maxLabel')}
          className={styles.slider}
        />
      </div>

      <div className={styles.sliderLabels}>
        <span className={styles.sliderLow}>{t('mileage.zero')}</span>
        {matchingCount !== null && (
          <span className={styles.sliderCount}>
            {t('listingCount', { count: matchingCount })}
          </span>
        )}
        <span className={styles.sliderHigh}>{highLabel}</span>
      </div>
      {withoutMileage !== null && (
        <p className={styles.noDataNote}>
          {t('mileage.withoutMileage', { count: withoutMileage })}
        </p>
      )}
    </div>
  )
}
