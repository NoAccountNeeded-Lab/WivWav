/** Existing listing plausibility bound, shared by shopping queries and index mapping. */
export const MAX_WHEELCHAIR_CAPACITY = 6
export const TRANSMISSIONS = ['automatic', 'manual', 'cvt', 'automated_manual'] as const
export type Transmission = typeof TRANSMISSIONS[number]

/** Preserve source transmission on the listing; use only this projection for facets. */
export function canonicalTransmission(raw: string | null | undefined): Transmission | null {
  const value = raw?.trim().toLowerCase().replace(/[-_]/g, ' ')
  if (!value) return null
  if (/\b(cvt|continuously variable)\b/.test(value)) return 'cvt'
  if (/\b(automated manual|dual clutch|dct)\b/.test(value)) return 'automated_manual'
  if (/\b(automatic|auto)\b/.test(value) || value === 'a/t' || /^\d+\s*a$/.test(value)) return 'automatic'
  if (/\b(manual)\b/.test(value) || value === 'm/t' || /^\d+\s*m$/.test(value)) return 'manual'
  return null
}

/** A single indexed value prevents city/state cross-product matches. */
export function cityStateKey(city: string | null | undefined, state: string | null | undefined): string | null {
  const name = city?.trim().replace(/\s+/g, ' ').toLowerCase()
  const region = state?.trim().toUpperCase()
  if (!name || name.length > 100 || /[,|]/.test(name) || !region || !/^[A-Z]{2}$/.test(region)) return null
  return `${name}|${region}`
}

export function validWheelchairCapacity(value: number | null | undefined): number | null {
  return value != null && Number.isInteger(value) && value >= 1 && value <= MAX_WHEELCHAIR_CAPACITY ? value : null
}
