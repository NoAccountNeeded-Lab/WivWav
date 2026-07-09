import { getTranslations } from 'next-intl/server'
import {
  ListingsResults,
  type ResultsPageLabels,
} from '@/app/filters/page'

interface ResultsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string>>
}

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const { locale } = await params
  const t = await getTranslations('FiltersPage')

  const labels: ResultsPageLabels = {
    personalizedHeading: t('personalizedHeading'),
    personalizedSummary: (count) => t('personalizedSummary', { count }),
    browseAllSummary: t('browseAllSummary'),
    searchResultsLabel: t('searchResultsLabel'),
    vehiclesFound: (count) => t('vehiclesFound', { count }),
    noVehicles: t('noVehicles'),
    noVehiclesForBrand: t('noVehiclesForBrand'),
    clearAllFilters: t('clearAllFilters'),
    searchUnavailableHeading: t('searchUnavailableHeading'),
    searchUnavailableMessage: t('searchUnavailableMessage'),
    paginationAriaLabel: t('pagination.ariaLabel'),
    previous: t('pagination.previous'),
    next: t('pagination.next'),
    pageOf: (page, totalPages) => t('pagination.pageOf', { page, totalPages }),
    listing: {
      callForPrice: t('listing.callForPrice'),
      cpo: t('listing.cpo'),
      rearEntry: t('listing.rearEntry'),
      sideEntry: t('listing.sideEntry'),
      inFloorRamp: t('listing.inFloorRamp'),
      foldOutRamp: t('listing.foldOutRamp'),
      foldInRamp: t('listing.foldInRamp'),
      privateSeller: t('listing.privateSeller'),
      wavFeaturesLabel: t('listing.wavFeaturesLabel'),
    },
  }

  return (
    <ListingsResults
      searchParams={searchParams}
      resultsPath={`/${locale}/results`}
      locale={locale}
      labels={labels}
      personalized
    />
  )
}
