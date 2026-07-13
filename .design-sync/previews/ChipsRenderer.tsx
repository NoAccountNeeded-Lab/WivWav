import { ChipsRenderer } from '@wivwav/web'

const makeItems = [
  { value: 'toyota', label: 'Toyota', count: 318, active: true, disabled: false },
  { value: 'honda', label: 'Honda', count: 204, active: false, disabled: false },
  { value: 'chrysler', label: 'Chrysler', count: 176, active: false, disabled: false },
  { value: 'dodge', label: 'Dodge', count: 152, active: false, disabled: false },
  { value: 'ford', label: 'Ford', count: 88, active: false, disabled: false },
  { value: 'kia', label: 'Kia', count: 41, active: false, disabled: false },
  { value: 'chevrolet', label: 'Chevrolet', count: 0, active: false, disabled: true },
]

export function Default() {
  return <ChipsRenderer items={makeItems} onToggle={() => {}} maxCount={318} />
}

const featureItemsManyActive = [
  { value: 'low_mileage', label: 'Low Mileage', count: 96, active: true, disabled: false },
  { value: 'one_owner', label: 'One Owner', count: 143, active: true, disabled: false },
  { value: 'clean_title', label: 'Clean Title', count: 512, active: true, disabled: false },
  { value: 'power_ramp', label: 'Power Ramp', count: 267, active: false, disabled: false },
  { value: 'kneeling', label: 'Kneeling System', count: 74, active: false, disabled: false },
]

export function MultipleSelected() {
  return <ChipsRenderer items={featureItemsManyActive} onToggle={() => {}} maxCount={512} />
}
