'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ActiveFilters } from '@/components/ActiveFilters'
import { buildSearchHref } from '@/lib/results-url'
import { DiscoverFacetGrid } from './DiscoverFacetGrid'
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
      {/* NavigationFocusReset adds tabindex="-1" to the h1 before this boundary hydrates. */}
      <h1 className={styles.pageHeading} suppressHydrationWarning>
        {t('heading')}
      </h1>

      <Suspense>
        <DiscoverActions resultsPath={resultsPath} />
      </Suspense>

      <section aria-label={t('filters')}>
        <Suspense>
          <DiscoverFacetGrid />
        </Suspense>
      </section>
    </div>
  )
}
