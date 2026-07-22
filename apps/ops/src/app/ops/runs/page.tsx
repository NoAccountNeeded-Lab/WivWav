import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { RunsClient } from './RunsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Listing import activity'),
}

export default function RunsPage() {
  return (
    <Suspense>
      <RunsClient apiBaseUrl={getPublicApiBaseUrl()} />
    </Suspense>
  )
}
