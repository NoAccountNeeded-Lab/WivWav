import { getPublicApiBaseUrl } from '@/lib/api-url'
import { RefreshListingsClient } from './RefreshListingsClient'

export default function RefreshListingsPage() {
  return <RefreshListingsClient apiBaseUrl={getPublicApiBaseUrl()} />
}
