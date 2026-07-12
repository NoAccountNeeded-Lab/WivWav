import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function RefreshListingsLoading() {
  return (
    <OpsRouteLoading
      title="Refresh listings"
      intro="Follow the safe sequence from source scrape through search and map verification."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </OpsRouteLoading>
  )
}
