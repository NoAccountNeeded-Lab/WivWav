import { SwatchesRenderer } from '@wivwav/web'

const colorItems = [
  { value: 'white', label: 'White', count: 214, active: true, disabled: false },
  { value: 'silver', label: 'Silver', count: 176, active: false, disabled: false },
  { value: 'black', label: 'Black', count: 149, active: false, disabled: false },
  { value: 'gray', label: 'Gray', count: 92, active: false, disabled: false },
  { value: 'blue', label: 'Blue', count: 58, active: false, disabled: false },
  { value: 'red', label: 'Red', count: 33, active: false, disabled: false },
  { value: 'tan', label: 'Tan', count: 21, active: false, disabled: false },
  { value: 'gold', label: 'Gold', count: 0, active: false, disabled: true },
]

export function Default() {
  return <SwatchesRenderer items={colorItems} onToggle={() => {}} maxCount={214} />
}

const fewColorItems = [
  { value: 'white', label: 'White', count: 4, active: false, disabled: false },
  { value: 'champagne', label: 'Champagne', count: 2, active: true, disabled: false },
  { value: 'charcoal', label: 'Charcoal', count: 1, active: false, disabled: false },
]

export function LightSwatchesWithBorder() {
  return <SwatchesRenderer items={fewColorItems} onToggle={() => {}} maxCount={4} />
}
