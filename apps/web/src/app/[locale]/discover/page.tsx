import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import { getServerApiBaseUrl } from '@/lib/api-url'
import { apiFetch } from '@/lib/api-fetch'
import { DiscoverPage } from './DiscoverPage'
import styles from './DiscoverPage.module.css'

export const metadata = {
  title: 'Discover — WivWav',
  description:
    'Explore wheelchair accessible vehicles by make, model, price, location, and accessibility features.',
}

interface DiscoverRouteProps {
  params: Promise<{ locale: string }>
}

// Fail open on a fetch error — an API hiccup shouldn't hide the whole
// filter-building UI, only a confirmed-empty catalog should.
async function catalogHasListings(): Promise<boolean> {
  try {
    const base = getServerApiBaseUrl()
    const url = new URL(`${base}/v1/listings`)
    url.searchParams.set('perPage', '1')
    const res = await apiFetch(url.toString(), { next: { revalidate: 0 } })
    if (!res.ok) return true
    const body = await res.json() as { pagination: { total: number } }
    return body.pagination.total > 0
  } catch {
    return true
  }
}

export default async function DiscoverRoute({ params }: DiscoverRouteProps) {
  const { locale } = await params
  const [t, hasListings] = await Promise.all([
    getTranslations({ locale, namespace: 'DiscoverPage' }),
    catalogHasListings(),
  ])

  return (
    <>
      <SiteHeader locale={locale} section={t('sectionTitle')} />
      <main id="main-content" tabIndex={-1}>
        {hasListings ? (
          <Suspense>
            <DiscoverPage resultsPath={`/${locale}/results`} />
          </Suspense>
        ) : (
          <div className={styles.page}>
            <h1 className={styles.pageHeading}>{t('sectionTitle')}</h1>
            <div className={styles.emptyState} role="status">
              <p>{t('noListingsYet')}</p>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
