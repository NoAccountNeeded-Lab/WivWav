import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { QueuesClient } from './QueuesClient'
import { SettingsProvider } from '../settings/SettingsProvider'

export const metadata: Metadata = {
  title: opsPageTitle('Queue diagnostics'),
}

export default function QueuesPage() {
  return <SettingsProvider apiBaseUrl={getPublicApiBaseUrl()}><QueuesClient apiBaseUrl={getPublicApiBaseUrl()} /></SettingsProvider>
}
