import { getPublicApiBaseUrl } from '@/lib/api-url'
import { SourcePipelineClient } from './SourcePipelineClient'

export default async function SourcePipelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SourcePipelineClient apiBaseUrl={getPublicApiBaseUrl()} sourceId={id} />
}
