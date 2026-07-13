import { Slider } from '@wivwav/web'

export function Default() {
  return (
    <div style={{ width: 320, padding: '24px 8px' }}>
      <Slider defaultValue={[45]} min={0} max={100} step={1} aria-label="Volume" />
    </div>
  )
}

export function PriceRange() {
  return (
    <div style={{ width: 320, padding: '24px 8px' }}>
      <Slider defaultValue={[12000, 38000]} min={0} max={75000} step={1000} aria-label="Price range" />
    </div>
  )
}

export function YearRange() {
  return (
    <div style={{ width: 320, padding: '24px 8px' }}>
      <Slider defaultValue={[2016, 2023]} min={2000} max={2026} step={1} aria-label="Year range" />
    </div>
  )
}

export function Disabled() {
  return (
    <div style={{ width: 320, padding: '24px 8px' }}>
      <Slider defaultValue={[20000, 45000]} min={0} max={75000} step={1000} aria-label="Price range" disabled />
    </div>
  )
}
