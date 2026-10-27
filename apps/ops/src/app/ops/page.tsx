import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { OpsOverviewClient } from './OpsOverviewClient'
import { SettingsProvider } from './settings/SettingsProvider'

export const metadata: Metadata = {
  title: opsPageTitle('Operations overview'),
}

export default function OpsPage() {
  return <SettingsProvider apiBaseUrl={getPublicApiBaseUrl()}><OpsOverviewClient apiBaseUrl={getPublicApiBaseUrl()} /></SettingsProvider>
}
