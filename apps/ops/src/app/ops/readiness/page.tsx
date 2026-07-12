import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { ReadinessClient } from './ReadinessClient'

export const metadata: Metadata = {
  title: opsPageTitle('Site readiness'),
}

export default function ReadinessPage() {
  return <ReadinessClient apiBaseUrl={getPublicApiBaseUrl()} />
}
