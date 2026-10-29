import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { ApiKeysClient } from './ApiKeysClient'

export const metadata: Metadata = {
  title: opsPageTitle('API keys'),
}

export default function ApiKeysPage() {
  return <ApiKeysClient apiBaseUrl={getPublicApiBaseUrl()} />
}
