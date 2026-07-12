import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { ConfigClient } from './ConfigClient'

export const metadata: Metadata = {
  title: opsPageTitle('AI provider settings'),
}

export default function ConfigPage() {
  return <ConfigClient apiBaseUrl={getPublicApiBaseUrl()} />
}
