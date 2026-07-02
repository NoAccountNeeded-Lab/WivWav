import { Suspense } from 'react'
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

  return (
    <>
      <SiteHeader section="Discover" />
      <main id="main-content" tabIndex={-1}>
        <Suspense>
          <DiscoverPage resultsPath={`/${locale}/results`} />
        </Suspense>
      </main>
    </>
  )
}
