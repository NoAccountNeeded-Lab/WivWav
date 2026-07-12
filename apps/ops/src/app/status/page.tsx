import type { Metadata } from 'next'
import { getPublicApiBaseUrl } from '@/lib/api-url'
import { opsPageTitle } from '@/lib/ops-title'
import { StatusDashboard } from './StatusDashboard'
import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: opsPageTitle('System status'),
}

export default function StatusPage() {
  return (
    <OpsShell sectionTitle="System status" nav={<OpsNav />}>
      <main id="main-content" className={styles.main}>
        <div className={styles.container}>
          <StatusDashboard apiBaseUrl={getPublicApiBaseUrl()} />
        </div>
      </main>
    </OpsShell>
  )
}
