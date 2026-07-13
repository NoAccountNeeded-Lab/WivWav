import { WavDetailsGrid } from '@wivwav/web'
import type { WavFeatures } from '@wivwav/types'

const fullyFeatured: WavFeatures = {
  conversionType: 'side_entry',
  conversionManufacturer: 'BraunAbility',
  floorLoweringInches: 10,
  rampType: 'in_floor',
  conversionStatus: 'complete',
  wavFeatures: ['transfer_seat', 'has_lift', 'lowered_floor', 'power_ramp'],
  wheelchairCapacity: 2,
}

const minimal: WavFeatures = {
  conversionType: 'rear_entry',
  conversionManufacturer: 'VMI',
  floorLoweringInches: null,
  rampType: 'fold_out',
  conversionStatus: 'proposed',
  wavFeatures: ['hand_controls'],
  wheelchairCapacity: null,
}

export function FullyFeatured() {
  return <WavDetailsGrid wav={fullyFeatured} />
}

export function MinimalFeatures() {
  return <WavDetailsGrid wav={minimal} />
}
