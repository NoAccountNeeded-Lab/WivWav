import { WavDetailsGrid } from '@/components/listing/WavDetailsGrid'
import { WavConversionInfo } from '@/components/listing/WavConversionInfo'
import type { ConversionBrandDetail, ConversionProduct } from '@/components/listing/conversionBrand'
import type { ListingDetail } from './types'
import styles from './tabs.module.css'

interface WavTabProps {
  listing: ListingDetail
  conversionBrand?: ConversionBrandDetail | null
  matchedConversionProduct?: ConversionProduct | null
}

export function WavTab({ listing, conversionBrand, matchedConversionProduct }: WavTabProps) {
  const { wav } = listing

  return (
    <div className={styles.tabContent}>
      <WavConversionInfo
        conversionType={wav.conversionType}
        conversionManufacturer={wav.conversionManufacturer}
        conversionBrand={conversionBrand}
        matchedProduct={matchedConversionProduct}
      />

      <WavDetailsGrid wav={wav} className={styles.wavGrid} />
    </div>
  )
}
