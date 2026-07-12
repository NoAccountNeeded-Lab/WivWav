import { OpsRouteLoading } from '@/components/OpsRouteLoading'
import { SkeletonCard } from '@/components/Skeleton'

export default function ConfigLoading() {
  return (
    <OpsRouteLoading
      title="AI provider settings"
      intro="Advanced configuration for AI providers, model names, and write-only API key secrets."
      backHref="/ops"
      backLabel="← Operations"
    >
      <SkeletonCard lines={4} />
    </OpsRouteLoading>
  )
}
