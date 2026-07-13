import { BarsRenderer } from '@wivwav/web'

const conversionTypeItems = [
  { value: 'rear_entry', label: 'Rear-Entry Ramp', count: 412, active: true, disabled: false },
  { value: 'side_entry', label: 'Side-Entry Ramp', count: 287, active: false, disabled: false },
  { value: 'turny_seat', label: 'Turny Seat', count: 94, active: false, disabled: false },
  { value: 'lift_equipped', label: 'Wheelchair Lift', count: 61, active: false, disabled: false },
  { value: 'lowered_floor', label: 'Lowered Floor (no ramp)', count: 18, active: false, disabled: false },
  { value: 'manual_transfer', label: 'Manual Transfer Seat', count: 0, active: false, disabled: true },
]

export function Default() {
  return <BarsRenderer items={conversionTypeItems} onToggle={() => {}} maxCount={412} />
}

const rampTypeItemsSparse = [
  { value: 'fold_out', label: 'Fold-Out Ramp', count: 7, active: false, disabled: false },
  { value: 'in_floor', label: 'In-Floor Ramp', count: 3, active: true, disabled: false },
]

export function FewOptions() {
  return <BarsRenderer items={rampTypeItemsSparse} onToggle={() => {}} maxCount={7} />
}
