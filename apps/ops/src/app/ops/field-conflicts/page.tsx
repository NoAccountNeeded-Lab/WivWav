import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { FieldConflictsClient } from './FieldConflictsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Field conflicts'),
}

export default function FieldConflictsPage() {
  return <FieldConflictsClient apiBaseUrl={getPublicApiBaseUrl()} />
}
