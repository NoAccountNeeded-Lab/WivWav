import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { PrivacyRequestsClient } from './PrivacyRequestsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Private-seller deletion requests'),
}

export default function PrivacyRequestsPage() {
  return <PrivacyRequestsClient apiBaseUrl={getPublicApiBaseUrl()} />
}
