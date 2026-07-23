import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { ProblemsClient } from './ProblemsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Problems'),
}

export default function ProblemsPage() {
  return <ProblemsClient apiBaseUrl={getPublicApiBaseUrl()} />
}
