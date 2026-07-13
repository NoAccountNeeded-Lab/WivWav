import { WavConversionInfo } from '@wivwav/web'

const braunAbility = {
  id: 'b1',
  name: 'BraunAbility',
  slug: 'braunability',
  website: 'https://www.braunability.com',
  nmedaCertified: true,
  founded: 1972,
  products: [],
}

const matchedProduct = {
  id: 'p1',
  name: 'BraunAbility Toyota Sienna Rampvan',
  conversionType: 'side_entry',
  rampType: 'in_floor',
  floorLoweringInches: 10,
  msrpCents: 5895000,
}

export function SideEntryWithMatchedProduct() {
  return (
    <WavConversionInfo
      conversionType="side_entry"
      conversionManufacturer="BraunAbility"
      conversionBrand={braunAbility}
      matchedProduct={matchedProduct}
    />
  )
}

export function RearEntryManufacturerOnly() {
  return (
    <WavConversionInfo
      conversionType="rear_entry"
      conversionManufacturer="Rollx Vans"
      conversionBrand={null}
      matchedProduct={null}
    />
  )
}
