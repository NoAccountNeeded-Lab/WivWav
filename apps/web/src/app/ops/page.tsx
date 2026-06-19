import { getPublicApiBaseUrl } from '@/lib/api-url'
import { OpsOverviewClient } from './OpsOverviewClient'

export default function OpsPage() {
  return <OpsOverviewClient apiBaseUrl={getPublicApiBaseUrl()} />
}
