import { getPublicApiBaseUrl } from '@/lib/api-url'
import { ReadinessClient } from './ReadinessClient'

export default function ReadinessPage() {
  return <ReadinessClient apiBaseUrl={getPublicApiBaseUrl()} />
}
