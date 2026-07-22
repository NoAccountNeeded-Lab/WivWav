'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CategoryBarChart } from '@/components/CategoryBarChart'
import { PriceHistogram } from '@/components/PriceHistogram'
import { YearHistogram } from '@/components/YearHistogram'
import { MileageHistogram } from '@/components/MileageHistogram'
import { ActiveFilters } from '@/components/ActiveFilters'
import { buildSearchHref } from '@/lib/results-url'
import styles from './DiscoverPage.module.css'

function DiscoverActions({ resultsPath }: { resultsPath: string }) {
  const t = useTranslations('DiscoverPage')
  const searchParams = useSearchParams()

  return (
    <div className={styles.actions}>
      <ActiveFilters />
      <div className={styles.ctaRow}>
        <a
          href={buildSearchHref(resultsPath, searchParams)}
          className={styles.ctaBtn}
        >
          {t('seeMatches')}
        </a>
        <a href={resultsPath} className={styles.skipLink}>
          {t('browseAll')}
        </a>
      </div>
    </div>
  )
}

export function DiscoverPage({ resultsPath = '/results' }: { resultsPath?: string }) {
  const t = useTranslations('DiscoverPage')

  return (
    <div className={styles.page}>
      <h1 className={styles.pageHeading}>{t('heading')}</h1>

      <Suspense>
        <DiscoverActions resultsPath={resultsPath} />
      </Suspense>

      <div className={styles.filterGrid}>
        <aside aria-label="Filter by vehicle type and brand">
          <Suspense>
            <CategoryBarChart
              showMap={false}
              showHistograms={false}
              singleColumn
              limitGroups={['make', 'model', 'condition', 'entry', 'conversionBrand']}
              renderers={{ condition: 'donut' }}
            />
          </Suspense>
        </aside>

        <aside aria-label="Filter by feature, location, and seller">
          <Suspense>
            <CategoryBarChart
              showMap={false}
              showHistograms={false}
              singleColumn
              limitGroups={['color', 'state', 'seller', 'features']}
              renderers={{ color: 'swatches', seller: 'donut' }}
            />
          </Suspense>
        </aside>

        <aside aria-label="Filter by price, year, and mileage">
          <Suspense><PriceHistogram /></Suspense>
          <Suspense><YearHistogram /></Suspense>
          <Suspense><MileageHistogram /></Suspense>
        </aside>
      </div>
    </div>
  )
}
