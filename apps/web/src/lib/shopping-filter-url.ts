/** Shared forwarding list for results, categorical facets and histograms. */
export const SHOPPING_FILTER_PARAMS = ['city', 'transmission', 'wheelchairCapacity', 'conversionStatus'] as const

export function shoppingFilterLabel(param: string, value: string, localizedValue?: (key: string) => string): string {
  if (param === 'city') {
    const [city, state] = value.split('|')
    return `${city?.replace(/\b\w/g, (letter) => letter.toUpperCase())}, ${state}`
  }
  if ((param === 'transmission' || param === 'conversionStatus') && localizedValue) return localizedValue(`${param}.${value}`)
  if (param === 'transmission' && value === 'cvt') return 'CVT'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** Preserve conflicting city selections so each remains visible and removable. */
export function removeFilterValue(params: URLSearchParams, param: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params)
  const remaining = (next.get(param) ?? '').split(',').filter((item) => item !== value)
  if (remaining.length) next.set(param, remaining.join(','))
  else next.delete(param)
  next.delete('page')
  return next
}
