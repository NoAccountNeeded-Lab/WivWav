import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function RunsLoading() {
  return (
    <OpsRouteLoading
      title="Listing import activity"
      intro="Track recent source runs, listing changes, failures, and stuck imports."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={9} />
    </OpsRouteLoading>
  )
}
