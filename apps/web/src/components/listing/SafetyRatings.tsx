import { useTranslations } from 'next-intl'
import type { SafetyRating } from '@/app/[locale]/listings/[id]/types'
import styles from './SafetyRatings.module.css'

interface SafetyRatingsProps {
  rating: SafetyRating
}

const RATING_ROWS: { key: keyof SafetyRating; labelKey: string }[] = [
  { key: 'overallRating', labelKey: 'overall' },
  { key: 'frontCrashRating', labelKey: 'frontCrash' },
  { key: 'sideCrashRating', labelKey: 'sideCrash' },
  { key: 'rolloverRating', labelKey: 'rollover' },
]

export function SafetyRatings({ rating }: SafetyRatingsProps) {
  const t = useTranslations('SafetyRatings')
  return (
    <div>
      <div className={styles.scoreRow}>
        {rating.overallRating != null && (
          <div className={styles.scoreCard}>
            <div className={styles.score}>
              {rating.overallRating}
              <span className={styles.denom}>{t('outOfFive')}</span>
            </div>
            <div className={styles.scoreLabel}>{t('overallCard')}</div>
          </div>
        )}
        {rating.frontCrashRating != null && (
          <div className={styles.scoreCard}>
            <div className={styles.score}>
              {rating.frontCrashRating}
              <span className={styles.denom}>{t('outOfFive')}</span>
            </div>
            <div className={styles.scoreLabel}>{t('frontCard')}</div>
          </div>
        )}
      </div>

      {RATING_ROWS.map(({ key, labelKey }) => {
        const raw = rating[key]
        if (raw === null || raw === undefined) return null
        const value = typeof raw === 'number' ? raw : null
        if (value === null) return null
        const displayVal = key === 'rolloverRating' ? (rating.rolloverRatingText ?? value) : value
        return (
          <div key={key} className={styles.barRow}>
            <div className={styles.barLabel}>{t(labelKey)}</div>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${(value / 5) * 100}%` }} />
            </div>
            <div className={styles.barValue}>{displayVal}</div>
          </div>
        )
      })}
    </div>
  )
}
