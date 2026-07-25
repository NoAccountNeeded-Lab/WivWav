import { WavDetailsGrid } from '@/components/listing/WavDetailsGrid'
import { WavConversionInfo } from '@/components/listing/WavConversionInfo'
import { WavConversionHistory } from '@/components/listing/WavConversionHistory'
import { NmedaDealersNearby } from '@/components/listing/NmedaDealersNearby'
import type { ConversionBrandDetail, ConversionProduct } from '@/components/listing/conversionBrand'
import type { ConversionHistoryEntry, NmeaDealer } from './types'
import type { ListingDetail } from './types'
import styles from './tabs.module.css'

interface WavTabProps {
  listing: ListingDetail
  conversionBrand?: ConversionBrandDetail | null
  matchedConversionProduct?: ConversionProduct | null
  nearbyDealers?: NmeaDealer[]
  hasCoordinates?: boolean
  conversionHistory?: ConversionHistoryEntry[]
}

export function WavTab({
  listing,
  conversionBrand,
  matchedConversionProduct,
  nearbyDealers = [],
  hasCoordinates = false,
  conversionHistory = [],
}: WavTabProps) {
  const { wav, fieldResolution } = listing
  const sourceUrl = listing.buyerUrl ?? listing.sourceUrl

  return (
    <div className={styles.tabContent}>
      <WavConversionInfo
        conversionType={wav.conversionType}
        conversionManufacturer={wav.conversionManufacturer}
        conversionBrand={conversionBrand}
        matchedProduct={matchedConversionProduct}
        conversionTypeStatus={fieldResolution?.conversionType}
        sourceUrl={sourceUrl}
      />

      <WavDetailsGrid wav={wav} rampTypeStatus={fieldResolution?.rampType} className={styles.wavGrid} />

      <WavConversionHistory history={conversionHistory} />

      <NmedaDealersNearby dealers={nearbyDealers} hasCoordinates={hasCoordinates} />
    </div>
  )
}
