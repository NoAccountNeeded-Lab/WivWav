import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { LogsClient } from './LogsClient'

export const metadata: Metadata = {
  title: opsPageTitle('Application logs'),
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>
}) {
  const { search } = await searchParams
  return <LogsClient apiBaseUrl={getPublicApiBaseUrl()} {...(search ? { initialSearch: search } : {})} />
}
