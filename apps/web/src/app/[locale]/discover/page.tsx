import { Suspense } from 'react'
import { SiteHeader } from '@/components/SiteHeader'
import { DiscoverPage } from './DiscoverPage'

export const metadata = {
  title: 'Discover — WivWav',
  description:
    "Tell us what you need in plain language and we'll find the right wheelchair accessible vehicle for you.",
}

export default function DiscoverRoute() {
  return (
    <>
      <SiteHeader section="Discover" />
      <main id="main-content" tabIndex={-1}>
        <Suspense>
          <DiscoverPage />
        </Suspense>
      </main>
    </>
  )
}
