import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function ReadinessLoading() {
  return (
    <OpsRouteLoading
      title="Site readiness"
      intro="Launch and handoff checklist for core services, inventory, search, queues, schedules, and scraper activity."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </OpsRouteLoading>
  )
}
