import { ActiveFilters, SearchParamsContext } from '@wivwav/web'

function withParams(qs: string) {
  return <SearchParamsContext.Provider value={new URLSearchParams(qs)}><ActiveFilters /></SearchParamsContext.Provider>
}

export function Default() {
  return withParams('priceMin=1500000&priceMax=4500000&make=toyota,honda&wavFeatures=has_lift,power_ramp')
}

export function ManyFilters() {
  return withParams(
    'priceMin=2000000&yearMin=2018&yearMax=2023&mileageMax=60000&conversionBrand=braunability&rampType=side,rear&state=OH&sellerType=dealer',
  )
}
