const RESULT_FILTER_KEYS = [
  'q',
  'make',
  'model',
  'trim',
  'yearMin',
  'yearMax',
  'priceMin',
  'priceMax',
  'mileageMax',
  'condition',
  'conversionBrand',
  'conversionType',
  'rampType',
  'wavFeatures',
  'color',
  'state',
  'sellerType',
  'fuelType',
] as const

type SearchParamsInput = { toString(): string }

interface SearchParamUpdates {
  [key: string]: string | null
}

export function buildSearchHref(
  pathname: string,
  currentParams: SearchParamsInput,
  updates: SearchParamUpdates = {},
  resetPage = false,
): string {
  const params = new URLSearchParams(currentParams.toString())

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  }

  if (resetPage) params.delete('page')

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function countActiveResultFilters(params: URLSearchParams): number {
  return RESULT_FILTER_KEYS.reduce(
    (count, key) => count + (params.get(key)?.trim() ? 1 : 0),
    0,
  )
}
