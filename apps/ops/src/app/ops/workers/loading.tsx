import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function WorkersLoading() {
  return (
    <OpsRouteLoading
      title="Workers"
      intro="Every connected crawler worker, what it is doing now, and fleet statistics."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={4} />
    </OpsRouteLoading>
  )
}
