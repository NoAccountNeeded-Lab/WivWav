import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { OPERATOR_SETTINGS, isOperatorSettingKey } from '@wivwav/types/operator-settings'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { SettingsProvider } from '../SettingsProvider'
import { SettingsClient } from '../SettingsClient'

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(OPERATOR_SETTINGS).map(key => ({ key }))
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params
  if (!isOperatorSettingKey(key)) notFound()
  return { title: opsPageTitle(key) }
}

export default async function SettingPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!isOperatorSettingKey(key)) notFound()
  return <SettingsProvider apiBaseUrl={getPublicApiBaseUrl()}><SettingsClient selectedKey={key} /></SettingsProvider>
}
