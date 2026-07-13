import { FilterGroup } from '@wivwav/web'

const conversionTypeItems = [
  { value: 'rear_entry', label: 'Rear-Entry Ramp', count: 412, active: true, disabled: false },
  { value: 'side_entry', label: 'Side-Entry Ramp', count: 287, active: false, disabled: false },
  { value: 'turny_seat', label: 'Turny Seat', count: 94, active: false, disabled: false },
  { value: 'lift_equipped', label: 'Wheelchair Lift', count: 61, active: false, disabled: false },
  { value: 'lowered_floor', label: 'Lowered Floor (no ramp)', count: 18, active: false, disabled: false },
  { value: 'manual_transfer', label: 'Manual Transfer Seat', count: 6, active: false, disabled: false },
  { value: 'scooter_lift', label: 'Scooter Lift', count: 3, active: false, disabled: true },
  { value: 'grade_two', label: 'Grade 2 Modified', count: 1, active: false, disabled: false },
  { value: 'grade_one', label: 'Grade 1 Modified', count: 1, active: false, disabled: false },
  { value: 'other_mobility', label: 'Other Mobility Equipment', count: 0, active: false, disabled: true },
]

export function Default() {
  return (
    <FilterGroup
      title="Conversion Type"
      labelId="facet-conversion-type"
      items={conversionTypeItems}
      onToggle={() => {}}
      renderer="bars"
    />
  )
}

const sellerTypeItems = [
  { value: 'dealer', label: 'Dealer', count: 398, active: true, disabled: false },
  { value: 'private', label: 'Private Seller', count: 211, active: false, disabled: false },
  { value: 'nmeda_certified', label: 'NMEDA Certified Dealer', count: 74, active: false, disabled: false },
]

export function ShortListNoShowMore() {
  return (
    <FilterGroup
      title="Seller Type"
      labelId="facet-seller-type"
      items={sellerTypeItems}
      onToggle={() => {}}
      renderer="chips"
    />
  )
}

const colorItems = [
  { value: 'white', label: 'White', count: 214, active: false, disabled: false },
  { value: 'silver', label: 'Silver', count: 176, active: true, disabled: false },
  { value: 'black', label: 'Black', count: 149, active: false, disabled: false },
  { value: 'gray', label: 'Gray', count: 92, active: false, disabled: false },
  { value: 'blue', label: 'Blue', count: 58, active: false, disabled: false },
]

export function SwatchesRendererVariant() {
  return (
    <FilterGroup
      title="Exterior Color"
      labelId="facet-color"
      items={colorItems}
      onToggle={() => {}}
      renderer="swatches"
      maxVisible={4}
    />
  )
}
