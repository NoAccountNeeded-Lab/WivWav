import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function EbayMotorsSearchLoading() {
  return (
    <OpsRouteLoading
      title="eBay Motors keyword tester"
      intro="Try different keywords and category IDs against the live Browse API search endpoint."
      backHref="/ops/sources"
      backLabel="← Source health"
    >
      <SkeletonCard lines={4} />
    </OpsRouteLoading>
  )
}
