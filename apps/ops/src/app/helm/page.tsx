import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { HelmWorkspace } from './HelmWorkspace'

export const metadata: Metadata = {
  title: opsPageTitle('Helm'),
}

// Rendered per request so the label reflects the running deployment, not the build machine.
export const dynamic = 'force-dynamic'

function environmentLabel(): string {
  const env = process.env['NODE_ENV']
  return env === 'production' ? 'Production' : env === 'test' ? 'Test' : 'Development'
}

export default function HelmPage() {
  return (
    <Suspense fallback={<p role="status">Loading Helm…</p>}>
      <HelmWorkspace apiBaseUrl={getPublicApiBaseUrl()} environment={environmentLabel()} />
    </Suspense>
  )
}
