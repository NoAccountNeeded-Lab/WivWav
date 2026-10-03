'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
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

const MULTI_PARAMS = [
  'make',
  'model',
  'trim',
  'condition',
  'conversionBrand',
  'conversionType',
  'color',
  'rampType',
  'state',
  'sellerType',
  'fuelType',
] as const

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

type Translate = ReturnType<typeof useTranslations>

interface PillText {
  t: Translate
  /** Resolves a WAV feature key to its localized label, or null when unknown. */
  featureLabel: (key: string) => string | null
  formatNumber: (value: number) => string
}

function buildPills(params: URLSearchParams, text: PillText): Pill[] {
  const { t, featureLabel, formatNumber } = text
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
      label = t('priceUpTo', { value: fmtDollars(max!) })
    }
    pills.push({ key: 'price', label, ariaLabel: t('removeFilter', { filter: t('removePrice') }), paramsToDelete: ['priceMin', 'priceMax'] })
  }

  // Multi-value
  for (const param of MULTI_PARAMS) {
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
      label = t('multiCount', { count: values.length, plural: t(`params.${param}.plural`) })
    }
    pills.push({
      key: param,
      label,
      ariaLabel: t('removeFilter', { filter: t(`params.${param}.name`) }),
      paramsToDelete: [param],
    })
  }

  // WAV features (comma-separated multi-value, one pill per selected feature)
  const wavFeaturesParam = params.get('wavFeatures')
  if (wavFeaturesParam) {
    const featureKeys = parseCommaSep(wavFeaturesParam)
    for (const key of featureKeys) {
      const label = featureLabel(key) ?? formatLabel(key)
      const remaining = featureKeys.filter((k) => k !== key)
      pills.push({
        key: `wavFeatures:${key}`,
        label,
        ariaLabel: t('removeFilter', { filter: label.toLowerCase() }),
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
    else label = t('yearUpTo', { year: yearMax ?? '' })
    pills.push({ key: 'year', label, ariaLabel: t('removeFilter', { filter: t('removeYear') }), paramsToDelete: ['yearMin', 'yearMax'] })
  }

  // Mileage
  const mileageMax = params.get('mileageMax')
  if (mileageMax) {
    const miles = parseInt(mileageMax, 10)
    pills.push({
      key: 'mileage',
      label: t('mileageUnder', { miles: formatNumber(miles) }),
      ariaLabel: t('removeFilter', { filter: t('removeMileage') }),
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
  const t = useTranslations('ActiveFilters')
  const featureT = useTranslations('FiltersPage.listing')
  const locale = useLocale()

  const pills = buildPills(new URLSearchParams(searchParams.toString()), {
    t,
    featureLabel: (key) => (featureT.has(`wavFeature_${key}`) ? featureT(`wavFeature_${key}`) : null),
    formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
  })

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
      aria-label={t('ariaLabel')}
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
            aria-label={t('clearAllAriaLabel')}
            onClick={clearAll}
          >
            {t('clearAll')}
          </button>
        </li>
      )}
    </ul>
  )
}
