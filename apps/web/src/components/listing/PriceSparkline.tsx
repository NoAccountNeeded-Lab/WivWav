import { useLocale, useTranslations } from 'next-intl'
import { formatPrice } from '@/app/[locale]/listings/[id]/utils'
import type { PricePoint } from '@/app/[locale]/listings/[id]/types'
import { sparklinePoints } from './priceSparklineUtils'
import styles from './PriceSparkline.module.css'

interface PriceSparklineProps {
  priceHistory: PricePoint[]
}

const WIDTH = 96
const HEIGHT = 24

/**
 * Compact inline trend line for the price-history stat strip — a glance-able
 * companion to the full chart on the Market tab, not a replacement for it.
 */
export function PriceSparkline({ priceHistory }: PriceSparklineProps) {
  const t = useTranslations('PriceSparkline')
  const callForPrice = useTranslations('ListingDetail')('callForPrice')
  const locale = useLocale()
  if (priceHistory.length < 2) return null

  const points = sparklinePoints(priceHistory, WIDTH, HEIGHT)
  const first = priceHistory[0]
  const last = priceHistory[priceHistory.length - 1]
  if (!first || !last) return null

  const price = (cents: number) => formatPrice(cents, locale, callForPrice)
  const trendLabel =
    last.priceCents === first.priceCents
      ? t('steady', { price: price(last.priceCents) })
      : last.priceCents < first.priceCents
        ? t('down', { price: price(last.priceCents), from: price(first.priceCents) })
        : t('up', { price: price(last.priceCents), from: price(first.priceCents) })

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={t('label', { count: priceHistory.length, trend: trendLabel })}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" className={styles.line} />
    </svg>
  )
}
