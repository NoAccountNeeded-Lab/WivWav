import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function SourcePipelineLoading() {
  return (
    <OpsRouteLoading
      title="Source pipeline"
      intro="Live per-stage pending, failed, and stall state for this source's ingest pipeline."
      backHref="/ops/sources"
      backLabel="← Sources"
    >
      <SkeletonCard lines={3} />
    </OpsRouteLoading>
  )
}
