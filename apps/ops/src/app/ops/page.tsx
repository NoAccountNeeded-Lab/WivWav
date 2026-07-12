import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { OpsOverviewClient } from './OpsOverviewClient'

export const metadata: Metadata = {
  title: opsPageTitle('Operations overview'),
}

export default function OpsPage() {
  return <OpsOverviewClient apiBaseUrl={getPublicApiBaseUrl()} />
}
