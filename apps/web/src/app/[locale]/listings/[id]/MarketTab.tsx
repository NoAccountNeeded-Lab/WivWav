import type { VinHistoryEntry } from '@wivwav/types'
import { useTranslations } from 'next-intl'
import { MarketComparison } from '@/components/listing/MarketComparison'
import { PriceHistoryChart } from '@/components/listing/PriceHistoryChart'
import { SimilarListings } from '@/components/listing/SimilarListings'
import { ListingDisclaimer } from '@/components/listing/ListingDisclaimer'
import { VinHistoryTimeline } from '@/components/listing/VinHistoryTimeline'
import { hasMultiListingVinHistory } from '@/components/listing/vinHistory'
import type { ListingDetail, MarketPricing, ModelMsrp, PricePoint, SimilarListing } from './types'
import styles from './tabs.module.css'

interface MarketTabProps {
  listing: ListingDetail
  marketPricing: MarketPricing | null
  priceHistory: PricePoint[]
  vinHistory: VinHistoryEntry[]
  similar: SimilarListing[]
  modelMsrp?: ModelMsrp | null
  vehiclePathPrefix?: string
}

export function MarketTab({
  listing,
  marketPricing,
  priceHistory,
  vinHistory,
  similar,
  modelMsrp,
  vehiclePathPrefix,
}: MarketTabProps) {
  const t = useTranslations('MarketTab')
  const hasMarket = marketPricing && marketPricing.count >= 3 && marketPricing.priceCents
  const hasVinHistory = hasMultiListingVinHistory(vinHistory)

  return (
    <div className={styles.tabContent}>
      <ListingDisclaimer categories={['market']} />

      {hasVinHistory && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('vinHistory')}</div>
          <VinHistoryTimeline history={vinHistory} currentListingId={listing.id} />
        </div>
      )}

      {priceHistory.length >= 2 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('priceHistory')}</div>
          <PriceHistoryChart
            priceHistory={priceHistory}
            originalMsrpCents={modelMsrp?.originalMsrpCents}
          />
        </div>
      )}

      {hasMarket ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('priceVsMarket')}</div>
          <MarketComparison
            priceCents={listing.priceCents}
            make={listing.make}
            model={listing.model}
            marketPricing={marketPricing}
            priceHistory={priceHistory}
          />
          {marketPricing.medianDaysListed != null && (
            <div className={styles.marketStat}>
              <span className={styles.marketStatVal}>{t('days', { count: marketPricing.medianDaysListed })}</span>
              <span className={styles.marketStatLabel}>{t('medianAge')}</span>
            </div>
          )}
        </div>
      ) : (
        <p className={styles.placeholder}>
          {t('notEnough')}
        </p>
      )}

      {similar.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t('similar')}</div>
          <SimilarListings
            listings={similar}
            make={listing.make}
            model={listing.model}
            pathPrefix={vehiclePathPrefix ?? ''}
          />
        </div>
      )}
    </div>
  )
}
