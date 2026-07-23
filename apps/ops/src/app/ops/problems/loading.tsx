import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function ProblemsLoading() {
  return (
    <OpsRouteLoading
      title="Problems"
      intro="Every active problem across services, sources, queues, schedules, Grafana alerts, and Sentry issues."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={6} />
    </OpsRouteLoading>
  )
}
