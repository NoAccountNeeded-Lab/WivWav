import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { SiteHeader } from '@/components/SiteHeader'
import { DiscoverPage } from './DiscoverPage'

export const metadata = {
  title: 'Discover — WivWav',
  description:
    "Tell us what you need in plain language and we'll find the right wheelchair accessible vehicle for you.",
}

interface DiscoverRouteProps {
  params: Promise<{ locale: string }>
}

export default async function DiscoverRoute({ params }: DiscoverRouteProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'DiscoverPage' })

  return (
    <>
      <SiteHeader locale={locale} section={t('sectionTitle')} />
      <main id="main-content" tabIndex={-1}>
        <Suspense>
          <DiscoverPage resultsPath={`/${locale}/results`} />
        </Suspense>
      </main>
    </>
  )
}
