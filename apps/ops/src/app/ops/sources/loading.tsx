import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { OpsTableSkeleton } from '@/components/OpsTableSkeleton'

export default function SourcesLoading() {
  return (
    <OpsRouteLoading
      title="Source health"
      intro="Review source status, observed inventory, publication eligibility, scrape timing, and source-specific errors."
      backHref="/ops"
      backLabel="← Operations"
    >
      <OpsTableSkeleton columns={9} />
    </OpsRouteLoading>
  )
}
