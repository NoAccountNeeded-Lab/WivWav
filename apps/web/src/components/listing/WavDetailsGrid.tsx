import {
  AlertTriangle,
  ArrowDownFromLine,
  ArrowUpDown,
  Armchair,
  DoorOpen,
  MoveDown,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { WAV_FEATURES } from '@wivwav/types'
import type { FieldResolutionState, RampType, WavFeature, WavFeatures } from '@wivwav/types'
import { WavFeatureItem } from './WavFeatureItem'

interface WavDetailsGridProps {
  wav: WavFeatures
  /**
   * #499 field-resolution status for `wav.rampType`. When `'conflicting'`,
   * `wav.rampType` already reads `'unknown'` (the API forces it) — this adds
   * a "needs verification" row instead of silently omitting the ramp-type
   * row as if there were no evidence at all.
   */
  rampTypeStatus?: FieldResolutionState | undefined
  className?: string | undefined
}

interface WavDetailRow {
  key: string
  icon: React.ReactNode
  label: string
  value: string
}

function featureIcon(feature: WavFeature): React.ReactNode {
  switch (feature) {
    case 'transfer_seat':
      return <Armchair size={16} aria-hidden />
    case 'has_lift':
      return <ArrowUpDown size={16} aria-hidden />
    case 'lowered_floor':
    case 'kneel_system':
      return <MoveDown size={16} aria-hidden />
    case 'power_ramp':
      return <ArrowDownFromLine size={16} aria-hidden />
    case 'automatic_door':
      return <DoorOpen size={16} aria-hidden />
    default:
      return <Settings2 size={16} aria-hidden />
  }
}

function rampValue(rampType: RampType): string | null {
  switch (rampType) {
    case 'in_floor':
      return 'In-floor ramp'
    case 'fold_out':
      return 'Fold-out ramp'
    case 'fold_in':
      return 'Fold-in ramp'
    default:
      return null
  }
}

function buildRows(wav: WavFeatures, rampTypeStatus: FieldResolutionState | undefined): WavDetailRow[] {
  const rows: WavDetailRow[] = (Object.keys(WAV_FEATURES) as WavFeature[])
    .filter((feature) => wav.wavFeatures.includes(feature))
    .map((feature) => ({
      key: `feature:${feature}`,
      icon: featureIcon(feature),
      label: WAV_FEATURES[feature],
      value: 'Included',
    }))

  if (wav.floorLoweringInches !== null) {
    rows.push({
      key: 'floor-lowering',
      icon: <MoveDown size={16} aria-hidden />,
      label: 'Floor lowering',
      value: `${wav.floorLoweringInches} inches`,
    })
  }

  const ramp = rampValue(wav.rampType)
  if (ramp !== null) {
    rows.push({
      key: 'ramp-type',
      icon: <ArrowDownFromLine size={16} aria-hidden />,
      label: 'Ramp type',
      value: ramp,
    })
  } else if (rampTypeStatus === 'conflicting') {
    // wav.rampType already reads 'unknown' here (the API forces it while
    // conflicting) — the text label itself carries the state so this row
    // never relies on color alone (docs/BRAND.md accessibility rule).
    rows.push({
      key: 'ramp-type',
      icon: <AlertTriangle size={16} aria-hidden />,
      label: 'Ramp type',
      value: 'Needs verification — see source listing',
    })
  }

  if (wav.wheelchairCapacity !== null) {
    rows.push({
      key: 'wheelchair-capacity',
      icon: <Users size={16} aria-hidden />,
      label: 'WC capacity',
      value: `${wav.wheelchairCapacity} chair${wav.wheelchairCapacity === 1 ? '' : 's'}`,
    })
  }

  if (wav.conversionStatus !== 'unknown') {
    rows.push({
      key: 'conversion-status',
      icon: <ShieldCheck size={16} aria-hidden />,
      label: 'Conversion status',
      value: wav.conversionStatus === 'complete' ? 'Complete' : 'Proposed',
    })
  }

  return rows
}

export function WavDetailsGrid({ wav, rampTypeStatus, className }: WavDetailsGridProps) {
  const rows = buildRows(wav, rampTypeStatus)

  if (rows.length === 0) return null

  return (
    <div className={className} role="list" aria-label="WAV details and accessibility features">
      {rows.map((row) => (
        <WavFeatureItem key={row.key} icon={row.icon} label={row.label} value={row.value} />
      ))}
    </div>
  )
}
