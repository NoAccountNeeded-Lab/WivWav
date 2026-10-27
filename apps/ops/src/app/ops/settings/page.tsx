import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { SettingsProvider } from './SettingsProvider'
import { SettingsClient } from './SettingsClient'

export const metadata: Metadata = { title: opsPageTitle('Operator settings') }

export default function SettingsPage() {
  return <SettingsProvider apiBaseUrl={getPublicApiBaseUrl()}><SettingsClient /></SettingsProvider>
}
