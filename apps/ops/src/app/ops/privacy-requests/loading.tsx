import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function PrivacyRequestsLoading() {
  return (
    <OpsRouteLoading
      title="Private-seller deletion requests"
      intro="Submit an authenticated deletion request for one private-seller listing and review its deletion history."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonCard lines={4} />
    </OpsRouteLoading>
  )
}
