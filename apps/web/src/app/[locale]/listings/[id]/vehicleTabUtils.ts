import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'
import type { VehicleStats } from './types'

/** `t` is the `VehicleTab` translator. */
export function deriveVisibleVehicleStats(
  vehicleStats: VehicleStats | null,
  t: Translate,
  locale: string,
): { label: string; value: string }[] {
  return [
    vehicleStats?.avgLifespanMiles !== null && vehicleStats?.avgLifespanMiles !== undefined
      ? {
          label: t('averageLifespan'),
          value: t('lifespanMiles', {
            miles: vehicleStats.avgLifespanMiles.toLocaleString(toIntlLocale(locale)),
          }),
        }
      : null,
    vehicleStats?.reliabilityScore !== null && vehicleStats?.reliabilityScore !== undefined
      ? { label: t('reliabilityScore'), value: String(vehicleStats.reliabilityScore) }
      : null,
    vehicleStats?.jdPowerScore !== null && vehicleStats?.jdPowerScore !== undefined
      ? { label: t('jdPowerScore'), value: String(vehicleStats.jdPowerScore) }
      : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null)
}

export function deriveShowVehicleStats(vehicleStats: VehicleStats | null): boolean {
  return (
    vehicleStats !== null &&
    (vehicleStats.avgLifespanMiles !== null ||
      vehicleStats.reliabilityScore !== null ||
      vehicleStats.jdPowerScore !== null ||
      Boolean(vehicleStats.methodology) ||
      vehicleStats.sources.length > 0)
  )
}
