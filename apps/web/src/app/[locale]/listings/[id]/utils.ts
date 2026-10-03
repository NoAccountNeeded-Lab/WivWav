import type { Translate } from '@/lib/intl'
import { toIntlLocale } from '@/lib/intl'

export function formatPrice(cents: number | null, locale: string, callForPrice: string): string {
  if (cents === null) return callForPrice
  return `$${(cents / 100).toLocaleString(toIntlLocale(locale))}`
}

export function formatEnum(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function daysSince(timestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000))
}

export function estimateMonthly(priceCents: number): number {
  const principal = (priceCents / 100) * 0.8
  const r = 0.065 / 12
  const n = 60
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -n)))
}

const LIFESPAN_MILES: Record<string, number> = {
  toyota: 250000,
  honda: 230000,
  chrysler: 230000,
  ford: 200000,
  gmc: 200000,
  chevrolet: 200000,
  kia: 210000,
  hyundai: 200000,
  dodge: 200000,
}

export function getExpectedLifespan(make: string): number {
  return LIFESPAN_MILES[make.toLowerCase()] ?? 200000
}

/** `t` is the `FiltersPage.listing` translator. */
export function conditionLabel(c: string, t: Translate): string {
  if (c === 'certified_pre_owned') return t('cpo')
  if (c === 'used') return t('conditionUsed')
  if (c === 'new') return t('conditionNew')
  return formatEnum(c)
}

/** `t` is the `FiltersPage.listing` translator. */
export function rampLabel(r: string, t: Translate): string {
  if (r === 'in_floor') return t('inFloorRamp')
  if (r === 'fold_out') return t('foldOutRamp')
  if (r === 'fold_in') return t('foldInRamp')
  return formatEnum(r)
}

export function abbreviate(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
}

export function formatK(miles: number): string {
  if (miles >= 1000) return `${Math.round(miles / 1000)}K`
  return String(miles)
}

export function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(toIntlLocale(locale), { year: 'numeric', month: 'short', day: 'numeric' })
}
