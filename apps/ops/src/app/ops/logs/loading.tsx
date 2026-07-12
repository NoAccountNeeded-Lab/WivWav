import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonListRow } from '@/components/Skeleton'

export default function LogsLoading() {
  return (
    <OpsRouteLoading
      title="Logs"
      intro="Search recent application events across services by source, severity, and message text."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonListRow count={10} />
    </OpsRouteLoading>
  )
}
