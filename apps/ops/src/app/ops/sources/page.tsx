import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { SourcesClient } from './SourcesClient'

export const metadata: Metadata = {
  title: opsPageTitle('Source health'),
}

export default function SourcesPage() {
  return <SourcesClient apiBaseUrl={getPublicApiBaseUrl()} />
}
