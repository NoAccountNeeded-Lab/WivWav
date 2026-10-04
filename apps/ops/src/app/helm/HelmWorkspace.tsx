'use client'

import { HelmHeader } from './HelmHeader'
import { HelmNav } from './HelmNav'
import { HelmOverview } from './HelmOverview'
import { InspectorHost } from './inspector/InspectorHost'
import { HelmProvider } from './helm-context'
import { useActionTracker } from './use-action-tracker'
import { useHelmData } from './use-helm-data'
import { useHelmLocation } from './use-helm-location'
import styles from './helm-shell.module.css'

interface HelmWorkspaceProps {
  apiBaseUrl: string
  environment: string
}

export function HelmWorkspace({ apiBaseUrl, environment }: HelmWorkspaceProps) {
  const data = useHelmData(apiBaseUrl)
  const nav = useHelmLocation()
  const tracker = useActionTracker(apiBaseUrl, data)

  return (
    <HelmProvider value={{ apiBaseUrl, data, nav, tracker }}>
      <InspectorHost
        header={<HelmHeader environment={environment} />}
        nav={<HelmNav />}
        main={(
          <main id="main-content" className={styles.main}>
            <HelmOverview />
          </main>
        )}
      />
    </HelmProvider>
  )
}
