'use client'

import { useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import styles from './ActiveFilters.module.css'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDollars(dollars: number): string {
  if (dollars === 0) return '$0'
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}k`
  return `$${dollars}`
}

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseCommaSep(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

const MULTI_PARAM_LABELS: Record<string, { singular: string; plural: string }> = {
  make:           { singular: 'Make',       plural: 'Makes'       },
  model:          { singular: 'Model',      plural: 'Models'      },
  trim:           { singular: 'Trim',       plural: 'Trims'       },
  condition:      { singular: 'Condition',  plural: 'Conditions'  },
  conversionBrand: { singular: 'Conversion brand', plural: 'Conversion brands' },
  conversionType: { singular: 'Entry type', plural: 'Entry types' },
  color:          { singular: 'Color',      plural: 'Colors'      },
  rampType:       { singular: 'Ramp type',  plural: 'Ramp types'  },
  state:          { singular: 'State',      plural: 'States'      },
  sellerType:     { singular: 'Seller type', plural: 'Seller types' },
  fuelType:       { singular: 'Fuel type',   plural: 'Fuel types'   },
}

const WAV_FEATURE_LABELS: Record<string, string> = {
  has_lift:                'Wheelchair Lift',
  hand_controls:           'Hand Controls',
  transfer_seat:           'Transfer Seat',
  kneel_system:            'Kneel System',
  lowered_floor:           'Lowered Floor',
  power_ramp:              'Power Ramp',
  tie_down_system:         'Tie-Down System',
  automatic_door:          'Automatic Door',
  motorized_running_board: 'Motorized Running Board',
}

const CONVERSION_BRAND_LABELS: Record<string, string> = {
  'ams-vans': 'AMS Vans',
  braunability: 'BraunAbility',
  'freedom-motors': 'Freedom Motors',
  'rollx-vans': 'Rollx Vans',
  'vantage-mobility': 'Vantage Mobility',
  vmi: 'VMI',
}

// ── Pill building ──────────────────────────────────────────────────────────

interface Pill {
  key: string
  label: string
  ariaLabel: string
  paramsToDelete: string[]
}

function buildPills(params: URLSearchParams): Pill[] {
  const pills: Pill[] = []

  // Price
  const priceMinCents = params.get('priceMin')
  const priceMaxCents = params.get('priceMax')
  if (priceMinCents || priceMaxCents) {
    const min = priceMinCents ? Math.floor(parseInt(priceMinCents, 10) / 100) : null
    const max = priceMaxCents ? Math.floor(parseInt(priceMaxCents, 10) / 100) : null
    let label: string
    if (min !== null && max !== null) {
      label = `${fmtDollars(min)}–${fmtDollars(max)}`
    } else if (min !== null) {
      label = `${fmtDollars(min)}+`
    } else {
      label = `Up to ${fmtDollars(max!)}`
    }
    pills.push({ key: 'price', label, ariaLabel: 'Remove price filter', paramsToDelete: ['priceMin', 'priceMax'] })
  }

  // Multi-value
  for (const [param, labels] of Object.entries(MULTI_PARAM_LABELS)) {
    const values = parseCommaSep(params.get(param))
    if (values.length === 0) continue
    let label: string
    if (values.length === 1) {
      label = param === 'conversionBrand'
        ? CONVERSION_BRAND_LABELS[values[0]!] ?? formatLabel(values[0]!)
        : formatLabel(values[0]!)
    } else if (values.length === 2) {
      label = values
        .map((value) => param === 'conversionBrand'
          ? CONVERSION_BRAND_LABELS[value] ?? formatLabel(value)
          : formatLabel(value))
        .join(', ')
    } else {
      label = `${values.length} ${labels.plural}`
    }
    pills.push({
      key: param,
      label,
      ariaLabel: `Remove ${labels.singular.toLowerCase()} filter`,
      paramsToDelete: [param],
    })
  }

  // WAV features (comma-separated multi-value, one pill per selected feature)
  const wavFeaturesParam = params.get('wavFeatures')
  if (wavFeaturesParam) {
    const featureKeys = parseCommaSep(wavFeaturesParam)
    for (const key of featureKeys) {
      const label = WAV_FEATURE_LABELS[key] ?? formatLabel(key)
      const remaining = featureKeys.filter((k) => k !== key)
      pills.push({
        key: `wavFeatures:${key}`,
        label,
        ariaLabel: `Remove ${label.toLowerCase()} filter`,
        paramsToDelete: remaining.length === 0 ? ['wavFeatures'] : [],
      })
    }
  }

  // Year range
  const yearMin = params.get('yearMin')
  const yearMax = params.get('yearMax')
  if (yearMin || yearMax) {
    let label: string
    if (yearMin && yearMax) label = `${yearMin}–${yearMax}`
    else if (yearMin) label = `${yearMin}+`
    else label = `Up to ${yearMax}`
    pills.push({ key: 'year', label, ariaLabel: 'Remove year filter', paramsToDelete: ['yearMin', 'yearMax'] })
  }

  // Mileage
  const mileageMax = params.get('mileageMax')
  if (mileageMax) {
    const miles = parseInt(mileageMax, 10)
    pills.push({
      key: 'mileage',
      label: `Under ${new Intl.NumberFormat('en-US').format(miles)} mi`,
      ariaLabel: 'Remove mileage filter',
      paramsToDelete: ['mileageMax'],
    })
  }

  return pills
}

// ── Component ──────────────────────────────────────────────────────────────

export function ActiveFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const pills = buildPills(new URLSearchParams(searchParams.toString()))

  if (pills.length === 0) return null

  const removePill = (paramsToDelete: string[], pill: Pill) => {
    const next = new URLSearchParams(searchParams.toString())
    // For wavFeatures pills, remove just this feature key from the comma list
    if (pill.key.startsWith('wavFeatures:')) {
      const featureKey = pill.key.slice('wavFeatures:'.length)
      const current = parseCommaSep(next.get('wavFeatures'))
      const remaining = current.filter((k) => k !== featureKey)
      if (remaining.length === 0) {
        next.delete('wavFeatures')
      } else {
        next.set('wavFeatures', remaining.join(','))
      }
    }
    for (const key of paramsToDelete) next.delete(key)
    next.delete('page')
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname, { scroll: false })
    })
  }

  return (
    <ul
      className={styles.pills}
      role="list"
      aria-label="Active filters"
      aria-live="polite"
    >
      {pills.map((pill) => (
        <li key={pill.key} className={styles.pill}>
          <span className={styles.pillLabel}>{pill.label}</span>
          <button
            type="button"
            className={styles.pillRemove}
            aria-label={pill.ariaLabel}
            onClick={() => removePill(pill.paramsToDelete, pill)}
          >
            ×
          </button>
        </li>
      ))}
      {pills.length >= 2 && (
        <li>
          <button
            type="button"
            className={`${styles.pill} ${styles.clearAll}`}
            aria-label="Clear all filters"
            onClick={clearAll}
          >
            Clear all ×
          </button>
        </li>
      )}
    </ul>
  )
}
