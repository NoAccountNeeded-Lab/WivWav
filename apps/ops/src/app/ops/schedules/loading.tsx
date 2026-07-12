import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function SchedulesLoading() {
  return (
    <OpsRouteLoading
      title="Recurring jobs"
      intro="Control when automatic listing refresh, geocoding, and safety-data jobs run."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={9} />
    </OpsRouteLoading>
  )
}
