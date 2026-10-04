import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function WorkersLoading() {
  return (
    <OpsRouteLoading
      title="Connected workers"
      intro="See which remote crawler workers are connected to the coordinator and how busy each one is."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={4} />
    </OpsRouteLoading>
  )
}
