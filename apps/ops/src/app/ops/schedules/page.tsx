import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { SchedulesClient } from './SchedulesClient'

export const metadata: Metadata = {
  title: opsPageTitle('Recurring jobs'),
}

export default function SchedulesPage() {
  return <SchedulesClient apiBaseUrl={getPublicApiBaseUrl()} />
}
