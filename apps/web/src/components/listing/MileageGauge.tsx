import { Check } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { toIntlLocale } from '@/lib/intl'
import { getExpectedLifespan, formatK } from '@/app/[locale]/listings/[id]/utils'
import styles from './MileageGauge.module.css'

interface MileageGaugeProps {
  mileage: number
  make: string
}

const MAX_GAUGE = 300000

export function MileageGauge({ mileage, make }: MileageGaugeProps) {
  const t = useTranslations('MileageGauge')
  const locale = useLocale()
  const fmt = (n: number) => n.toLocaleString(toIntlLocale(locale))
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>
  const avgLifespan = getExpectedLifespan(make)
  const mileagePct = Math.min((mileage / MAX_GAUGE) * 100, 100)
  const lifespanPct = Math.min((avgLifespan / MAX_GAUGE) * 100, 100)
  const lifeUsedPct = Math.round((mileage / avgLifespan) * 100)

  return (
    <div>
      <div
        className={styles.track}
        role="img"
        aria-label={t('label', {
          mileage: fmt(mileage),
          scale: fmt(MAX_GAUGE),
          make,
          lifespan: fmt(avgLifespan),
        })}
      >
        <div className={styles.fill} style={{ width: `${mileagePct}%` }} />
        <div className={styles.marker} style={{ left: `${lifespanPct}%` }} />
      </div>

      <div className={styles.scaleLabels} aria-hidden>
        <span>0</span>
        <span>{formatK(MAX_GAUGE * 0.25)}</span>
        <span>{formatK(MAX_GAUGE * 0.5)}</span>
        <span>{formatK(MAX_GAUGE * 0.75)}</span>
        <span>{formatK(MAX_GAUGE)}</span>
      </div>

      <div className={styles.legendRow}>
        <div className={styles.legendItem}>
          <div className={styles.dotOrange} />
          <span className={styles.legendText}>
            {t.rich('thisVehicle', { miles: t('miles', { miles: fmt(mileage) }), strong })}
          </span>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.dotGreen} />
          <span className={styles.legendText}>
            {t.rich('avgLifespan', { miles: t('miles', { miles: fmt(avgLifespan) }), make, strong })}
          </span>
        </div>
      </div>

      <div className={styles.note}>
        <Check size={13} aria-hidden />
        {t('lifeUsed', { percent: lifeUsedPct })}
        {lifeUsedPct < 50 ? t('strong') : lifeUsedPct < 80 ? t('solid') : t('higher')}
      </div>
    </div>
  )
}
