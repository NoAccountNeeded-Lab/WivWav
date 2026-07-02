import { getPublicApiBaseUrl } from '@/lib/api-url'
import { LogsClient } from './LogsClient'

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>
}) {
  const { search } = await searchParams
  return <LogsClient apiBaseUrl={getPublicApiBaseUrl()} {...(search ? { initialSearch: search } : {})} />
}
