import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { RefreshListingsClient } from './RefreshListingsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Listing refresh workflow'),
}

export default function RefreshListingsPage() {
  return <RefreshListingsClient apiBaseUrl={getPublicApiBaseUrl()} />
}
