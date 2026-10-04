import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { WorkersClient } from './WorkersClient'

export const metadata: Metadata = {
  title: opsPageTitle('Connected workers'),
}

export default function WorkersPage() {
  return <WorkersClient apiBaseUrl={getPublicApiBaseUrl()} />
}
