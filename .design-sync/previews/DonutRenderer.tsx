import { DonutRenderer } from '@wivwav/web'

const conditionItems = [
  { value: 'used', label: 'Used', count: 486, active: false, disabled: false },
  { value: 'certified', label: 'Certified Pre-Owned', count: 152, active: false, disabled: false },
  { value: 'new', label: 'New', count: 37, active: false, disabled: false },
  { value: 'salvage', label: 'Salvage / Rebuilt', count: 6, active: false, disabled: true },
]

export function Default() {
  return <DonutRenderer items={conditionItems} onToggle={() => {}} maxCount={486} />
}

const sellerTypeItemsActive = [
  { value: 'dealer', label: 'Dealer', count: 398, active: true, disabled: false },
  { value: 'private', label: 'Private Seller', count: 211, active: false, disabled: false },
  { value: 'nmeda_certified', label: 'NMEDA Certified Dealer', count: 74, active: false, disabled: false },
]

export function WithActiveSelection() {
  return <DonutRenderer items={sellerTypeItemsActive} onToggle={() => {}} maxCount={398} />
}
