import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { SourcePipelineClient } from './SourcePipelineClient'

// Not registered in OPS_NAV_GROUPS (dynamic `[id]` detail route), so this
// title is literal rather than looked up from the nav registry.
export const metadata: Metadata = {
  title: opsPageTitle('Source pipeline'),
}

export default async function SourcePipelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SourcePipelineClient apiBaseUrl={getPublicApiBaseUrl()} sourceId={id} />
}
