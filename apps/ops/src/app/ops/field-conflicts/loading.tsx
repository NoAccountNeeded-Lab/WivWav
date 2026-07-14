import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function FieldConflictsLoading() {
  return (
    <OpsRouteLoading
      title="Field conflicts"
      intro="Listings whose entry type or ramp type has conflicting evidence and cannot be published as a definitive value."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={6} />
    </OpsRouteLoading>
  )
}
