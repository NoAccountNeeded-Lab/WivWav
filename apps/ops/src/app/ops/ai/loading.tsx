import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function AiLoading() {
  return (
    <OpsRouteLoading
      title="Source repair"
      intro="Check AI service health and repair sources whose page layout changed."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonCard lines={4} />
    </OpsRouteLoading>
  )
}
