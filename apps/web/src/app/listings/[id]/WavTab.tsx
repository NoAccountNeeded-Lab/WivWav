import {
  ArrowDownFromLine,
  ArrowUpDown,
  Armchair,
  MoveDown,
  Settings2,
  Users,
} from 'lucide-react'
import { WavFeatureItem } from '@/components/listing/WavFeatureItem'
import { WavConversionInfo } from '@/components/listing/WavConversionInfo'
import type { ConversionBrandDetail, ConversionProduct } from '@/components/listing/conversionBrand'
import { rampLabel } from './utils'
import type { ListingDetail } from './types'
import styles from './tabs.module.css'

interface WavTabProps {
  listing: ListingDetail
  conversionBrand?: ConversionBrandDetail | null
  matchedConversionProduct?: ConversionProduct | null
}

export function WavTab({ listing, conversionBrand, matchedConversionProduct }: WavTabProps) {
  const { wav } = listing
  const ramp =
    wav.rampType !== 'none' && wav.rampType !== 'unknown'
      ? rampLabel(wav.rampType)
      : null

  return (
    <div className={styles.tabContent}>
      <WavConversionInfo
        conversionType={wav.conversionType}
        conversionManufacturer={wav.conversionManufacturer}
        conversionBrand={conversionBrand}
        matchedProduct={matchedConversionProduct}
      />

      <div className={styles.wavGrid} role="list" aria-label="WAV accessibility features">
        <WavFeatureItem
          icon={<MoveDown size={16} aria-hidden />}
          label="Floor lowering"
          value={wav.floorLoweringInches !== null ? `${wav.floorLoweringInches} inches` : null}
        />
        <WavFeatureItem
          icon={<ArrowDownFromLine size={16} aria-hidden />}
          label="Ramp type"
          value={ramp}
        />
        <WavFeatureItem
          icon={<Users size={16} aria-hidden />}
          label="WC capacity"
          value={
            wav.wheelchairCapacity
              ? `${wav.wheelchairCapacity} chair${wav.wheelchairCapacity > 1 ? 's' : ''}`
              : null
          }
        />
        <WavFeatureItem
          icon={<Armchair size={16} aria-hidden />}
          label="Transfer seat"
          value={wav.wavFeatures.includes('transfer_seat') ? 'Included' : null}
        />
        <WavFeatureItem
          icon={<Settings2 size={16} aria-hidden />}
          label="Hand controls"
          value={wav.wavFeatures.includes('hand_controls') ? 'Included' : null}
        />
        <WavFeatureItem
          icon={<ArrowUpDown size={16} aria-hidden />}
          label="Lift"
          value={wav.wavFeatures.includes('has_lift') ? 'Included' : null}
        />
      </div>
    </div>
  )
}
