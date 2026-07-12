import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function QueuesLoading() {
  return (
    <OpsRouteLoading
      title="Advanced queue diagnostics"
      intro="Inspect raw background jobs, trigger maintenance work, and sync listing changes into search."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={8} />
    </OpsRouteLoading>
  )
}
