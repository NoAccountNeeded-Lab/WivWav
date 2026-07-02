import type { ListingDetail } from '@/app/listings/[id]/types'

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
): VehicleSpec[] {
  const specs: VehicleSpec[] = []

  if (bodyType) specs.push({ label: 'Body type', value: bodyType })
  if (listing.engine && !researchedFields.has('engineDescription')) {
    specs.push({ label: 'Engine', value: listing.engine })
  }
  if (listing.transmission && !researchedFields.has('transmission')) {
    specs.push({ label: 'Transmission', value: listing.transmission })
  }
  if (listing.fuelType && !researchedFields.has('fuelType')) {
    specs.push({ label: 'Fuel type', value: listing.fuelType })
  }
  if (listing.color) specs.push({ label: 'Exterior color', value: listing.color })
  if (listing.condition) {
    specs.push({ label: 'Condition', value: listing.condition.replace(/_/g, ' ') })
  }
  if (listing.vin) specs.push({ label: 'VIN', value: listing.vin, mono: true })
  if (listing.stockNumber) {
    specs.push({ label: 'Seller stock number', value: listing.stockNumber, mono: true })
  }

  return specs
}
