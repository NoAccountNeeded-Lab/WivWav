import type { Translate } from '@/lib/intl'
import type { ListingDetail } from '@/app/[locale]/listings/[id]/types'

export interface VehicleSpec {
  label: string
  value: string
  mono?: boolean
}

type ListingSpecFields = Pick<
  ListingDetail,
  'engine' | 'transmission' | 'fuelType' | 'color' | 'condition' | 'vin' | 'stockNumber'
>

export function deriveListingSpecs(
  listing: ListingSpecFields,
  bodyType: string | null,
  researchedFields: ReadonlySet<string>,
  /** The `VehicleTab` translator. */
  t: Translate,
): VehicleSpec[] {
  const specs: VehicleSpec[] = []

  if (bodyType) specs.push({ label: t('specs.bodyType'), value: bodyType })
  if (listing.engine && !researchedFields.has('engineDescription')) {
    specs.push({ label: t('specs.engine'), value: listing.engine })
  }
  if (listing.transmission && !researchedFields.has('transmission')) {
    specs.push({ label: t('specs.transmission'), value: listing.transmission })
  }
  if (listing.fuelType && !researchedFields.has('fuelType')) {
    specs.push({ label: t('specs.fuelType'), value: listing.fuelType })
  }
  if (listing.color) specs.push({ label: t('specs.exteriorColor'), value: listing.color })
  if (listing.condition) {
    specs.push({ label: t('specs.condition'), value: listing.condition.replace(/_/g, ' ') })
  }
  if (listing.vin) specs.push({ label: t('specs.vin'), value: listing.vin, mono: true })
  if (listing.stockNumber) {
    specs.push({ label: t('specs.stockNumber'), value: listing.stockNumber, mono: true })
  }

  return specs
}
