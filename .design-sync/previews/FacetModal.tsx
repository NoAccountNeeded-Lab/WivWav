import { FacetModal } from '@wivwav/web'
import { BarsRenderer } from '@wivwav/web'

const rampTypeItems = [
  { value: 'rear_entry', label: 'Rear-Entry Ramp', count: 412, active: true, disabled: false },
  { value: 'side_entry', label: 'Side-Entry Ramp', count: 287, active: false, disabled: false },
  { value: 'turny_seat', label: 'Turny Seat', count: 94, active: false, disabled: false },
  { value: 'lift_equipped', label: 'Wheelchair Lift', count: 61, active: false, disabled: false },
  { value: 'lowered_floor', label: 'Lowered Floor (no ramp)', count: 18, active: false, disabled: false },
  { value: 'manual_transfer', label: 'Manual Transfer Seat', count: 6, active: false, disabled: false },
  { value: 'scooter_lift', label: 'Scooter Lift', count: 3, active: false, disabled: true },
]

export function Default() {
  return (
    <FacetModal title="Conversion Type" onClose={() => {}}>
      <BarsRenderer items={rampTypeItems} onToggle={() => {}} maxCount={412} />
    </FacetModal>
  )
}

const makeItems = Array.from({ length: 14 }, (_, i) => ({
  value: `make_${i}`,
  label: [
    'Toyota', 'Honda', 'Chrysler', 'Dodge', 'Ford', 'Kia', 'Chevrolet', 'Nissan',
    'Hyundai', 'Ram', 'GMC', 'Volkswagen', 'Buick', 'Mercedes-Benz',
  ][i]!,
  count: 320 - i * 20,
  active: i === 0,
  disabled: false,
}))

export function LongScrollableList() {
  return (
    <FacetModal title="Make" onClose={() => {}}>
      <BarsRenderer items={makeItems} onToggle={() => {}} maxCount={320} />
    </FacetModal>
  )
}
