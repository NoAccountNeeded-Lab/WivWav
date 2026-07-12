import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { AIClient } from './AIClient'

export const metadata: Metadata = {
  title: opsPageTitle('Source repair'),
}

export default function AiPage() {
  return <AIClient apiBaseUrl={getPublicApiBaseUrl()} />
}
