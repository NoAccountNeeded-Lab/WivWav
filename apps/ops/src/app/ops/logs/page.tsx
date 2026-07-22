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
  searchParams: Promise<{ search?: string; service?: string; start?: string; end?: string }>
}) {
  const { search, service, start, end } = await searchParams
  return (
    <LogsClient
      apiBaseUrl={getPublicApiBaseUrl()}
      {...(search ? { initialSearch: search } : {})}
      {...(service ? { initialService: service } : {})}
      {...(start ? { initialStart: start } : {})}
      {...(end ? { initialEnd: end } : {})}
    />
  )
}
