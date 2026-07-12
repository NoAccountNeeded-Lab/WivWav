import { getPublicApiBaseUrl } from '@/lib/api-url'
import { StatusDashboard } from './StatusDashboard'
import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'
import styles from './page.module.css'

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
