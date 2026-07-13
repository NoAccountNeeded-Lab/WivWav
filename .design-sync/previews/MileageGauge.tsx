import { MileageGauge } from '@wivwav/web'

export function LowMileageToyota() {
  return <MileageGauge mileage={34200} make="Toyota" />
}

export function MidMileageHonda() {
  return <MileageGauge mileage={118500} make="Honda" />
}

export function HighMileageFord() {
  return <MileageGauge mileage={187300} make="Ford" />
}
