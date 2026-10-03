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
import { useTranslations } from 'next-intl'
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

type Translate = ReturnType<typeof useTranslations>

function rampValue(rampType: RampType, t: Translate): string | null {
  switch (rampType) {
    case 'in_floor':
      return t('inFloorRamp')
    case 'fold_out':
      return t('foldOutRamp')
    case 'fold_in':
      return t('foldInRamp')
    default:
      return null
  }
}

function buildRows(
  wav: WavFeatures,
  rampTypeStatus: FieldResolutionState | undefined,
  t: Translate,
  featureT: Translate,
): WavDetailRow[] {
  const rows: WavDetailRow[] = [...wav.wavFeatures]
    .map((feature) => ({
      key: `feature:${feature}`,
      icon: featureIcon(feature),
      label: featureT(`wavFeature_${feature}`),
      value: t('included'),
    }))

  if (wav.floorLoweringInches !== null) {
    rows.push({
      key: 'floor-lowering',
      icon: <MoveDown size={16} aria-hidden />,
      label: t('floorLowering'),
      value: t('inches', { inches: wav.floorLoweringInches }),
    })
  }

  const ramp = rampValue(wav.rampType, t)
  if (ramp !== null) {
    rows.push({
      key: 'ramp-type',
      icon: <ArrowDownFromLine size={16} aria-hidden />,
      label: t('rampType'),
      value: ramp,
    })
  } else if (rampTypeStatus === 'conflicting') {
    // wav.rampType already reads 'unknown' here (the API forces it while
    // conflicting) — the text label itself carries the state so this row
    // never relies on color alone (docs/BRAND.md accessibility rule).
    rows.push({
      key: 'ramp-type',
      icon: <AlertTriangle size={16} aria-hidden />,
      label: t('rampType'),
      value: t('needsVerification'),
    })
  }

  if (wav.wheelchairCapacity !== null) {
    rows.push({
      key: 'wheelchair-capacity',
      icon: <Users size={16} aria-hidden />,
      label: t('wcCapacity'),
      value: t('chairs', { count: wav.wheelchairCapacity }),
    })
  }

  if (wav.conversionStatus !== 'unknown') {
    rows.push({
      key: 'conversion-status',
      icon: <ShieldCheck size={16} aria-hidden />,
      label: t('conversionStatus'),
      value: wav.conversionStatus === 'complete' ? t('complete') : t('proposed'),
    })
  }

  return rows
}

export function WavDetailsGrid({ wav, rampTypeStatus, className }: WavDetailsGridProps) {
  const t = useTranslations('WavDetails')
  const featureT = useTranslations('FiltersPage.listing')
  const rows = buildRows(wav, rampTypeStatus, t, featureT)

  if (rows.length === 0) return null

  return (
    <div className={className} role="list" aria-label={t('label')}>
      {rows.map((row) => (
        <WavFeatureItem key={row.key} icon={row.icon} label={row.label} value={row.value} />
      ))}
    </div>
  )
}
