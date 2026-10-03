import { TrendingDown, TrendingUp } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { formatPrice, formatDate } from '@/app/[locale]/listings/[id]/utils'
import { toIntlLocale } from '@/lib/intl'
import { pricePositionPercent } from '@/app/[locale]/listings/[id]/marketTabUtils'
import type { MarketPricing, PricePoint } from '@/app/[locale]/listings/[id]/types'
import styles from './MarketComparison.module.css'

interface MarketComparisonProps {
  priceCents: number | null
  make: string
  model: string
  marketPricing: MarketPricing
  priceHistory: PricePoint[]
}

// Approximate bell-curve heights peaking near median
const HIST_HEIGHTS = [20, 45, 75, 100, 80, 55, 30, 20, 12, 8]

export function MarketComparison({ priceCents, make, model, marketPricing, priceHistory }: MarketComparisonProps) {
  const t = useTranslations('MarketComparison')
  const callForPrice = useTranslations('ListingDetail')('callForPrice')
  const locale = useLocale()
  const price = (cents: number | null) => formatPrice(cents, locale, callForPrice)
  const mp = marketPricing.priceCents
  if (!mp) return null

  let currentBucket = -1
  if (priceCents !== null) {
    if (priceCents < mp.p10) currentBucket = 0
    else if (priceCents < mp.p25) currentBucket = 1
    else if (priceCents < mp.p50) currentBucket = 3
    else if (priceCents < mp.p75) currentBucket = 5
    else if (priceCents < mp.p90) currentBucket = 7
    else currentBucket = 9
  }

  const pctVsMedian =
    priceCents !== null
      ? Math.round(((mp.p50 - priceCents) / mp.p50) * 100)
      : null

  const positionPct = pricePositionPercent(priceCents, { p10: mp.p10, p90: mp.p90 })

  const firstPoint = priceHistory.length >= 2 ? priceHistory[0] : undefined
  const lastPoint = priceHistory.length >= 2 ? priceHistory[priceHistory.length - 1] : undefined
  const priceDrop = firstPoint && lastPoint ? firstPoint.priceCents - lastPoint.priceCents : null

  return (
    <div>
      {/* Histogram */}
      <div
        className={styles.bars}
        role="img"
        aria-label={t('distributionLabel', { make, model, median: price(mp.p50) })}
      >
        {HIST_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className={styles.bar}
            style={{
              height: `${h}%`,
              background: i === currentBucket ? 'var(--clr-primary)' : 'var(--clr-border)',
            }}
          />
        ))}
      </div>

      <div className={styles.labels} aria-hidden>
        <span>{price(mp.p10)}</span>
        <span>{price(mp.p25)}</span>
        <span>{price(mp.p50)}</span>
        <span>{price(mp.p75)}</span>
        <span>{price(mp.p90)}+</span>
      </div>

      {/* Continuous position indicator — where this exact price falls between
          p10 and p90, distinct from the discrete histogram bucket above. */}
      {positionPct !== null && priceCents !== null && (
        <div
          className={styles.bandTrack}
          role="img"
          aria-label={t('positionLabel', {
            price: price(priceCents),
            percent: Math.round(positionPct),
            p10: price(mp.p10),
            p90: price(mp.p90),
          })}
        >
          <div className={styles.bandMarker} style={{ left: `${positionPct}%` }} />
        </div>
      )}

      {pctVsMedian !== null && (
        <div className={pctVsMedian >= 0 ? styles.noteBelow : styles.noteAbove}>
          {pctVsMedian >= 0 ? <TrendingDown size={13} aria-hidden /> : <TrendingUp size={13} aria-hidden />}
          {pctVsMedian >= 0
            ? t('pctBelow', { percent: pctVsMedian })
            : t('pctAbove', { percent: Math.abs(pctVsMedian) })}{' '}
          — {t('comparable', { make, model, median: price(mp.p50), count: marketPricing.count })}
        </div>
      )}

      {/* Price drop history */}
      {priceDrop !== null && priceDrop > 0 && lastPoint && (
        <div className={styles.priceDrop}>
          <TrendingDown size={13} aria-hidden />
          {t('priceReduced', {
            amount: `$${(priceDrop / 100).toLocaleString(toIntlLocale(locale))}`,
            date: formatDate(lastPoint.recordedAt, locale),
          })}
        </div>
      )}
    </div>
  )
}
