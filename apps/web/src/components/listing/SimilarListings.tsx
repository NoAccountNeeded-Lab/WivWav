import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { toIntlLocale } from '@/lib/intl'
import { formatPrice, rampLabel, daysSince } from '@/app/[locale]/listings/[id]/utils'
import type { SimilarListing } from '@/app/[locale]/listings/[id]/types'
import { vehicleDetailPath } from '@/lib/vehicle-url'
import styles from './SimilarListings.module.css'

interface SimilarListingsProps {
  listings: SimilarListing[]
  make: string
  model: string
  pathPrefix?: string
}

export function SimilarListings({ listings, make, model, pathPrefix = '' }: SimilarListingsProps) {
  const t = useTranslations('SimilarListings')
  const listingT = useTranslations('FiltersPage.listing')
  const detailT = useTranslations('ListingDetail')
  const locale = useLocale()
  if (listings.length === 0) return null

  return (
    <div>
      <ul className={styles.list}>
        {listings.map((s) => {
          const simDays = daysSince(s.sourceListedAt ?? s.listedAt)
          const ageLabel = s.sourceListedAt != null
            ? simDays > 0 ? t('daysOnSource', { days: simDays }) : t('onSourceToday')
            : simDays > 0 ? t('foundDaysAgo', { days: simDays }) : t('foundToday')
          const metaParts = [
            s.rampType !== 'none' && s.rampType !== 'unknown' ? rampLabel(s.rampType, listingT) : null,
            s.conversionManufacturer ?? null,
            s.mileage !== null ? t('miles', { miles: s.mileage.toLocaleString(toIntlLocale(locale)) }) : null,
            ageLabel,
          ].filter(Boolean).join(' · ')

          return (
            <li key={s.id}>
              <Link href={vehicleDetailPath(s.id, pathPrefix)} className={styles.item}>
                <div>
                  <div className={styles.name}>
                    {s.year} {s.make} {s.model}
                    {s.condition === 'new' && (
                      <span className={styles.newBadge}>{t('new')}</span>
                    )}
                  </div>
                  {metaParts && <div className={styles.meta}>{metaParts}</div>}
                </div>
                <div className={styles.right}>
                  <div className={styles.price}>{formatPrice(s.priceCents, locale, detailT('callForPrice'))}</div>
                  {(s.city || s.state) && (
                    <div className={styles.location}>
                      {[s.city, s.state].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      <Link
        href={`/filters?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`}
        className={styles.seeAll}
      >
        {t('seeAll', { make, model })}
      </Link>
    </div>
  )
}
